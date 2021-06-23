import { BentleyStatus, ClientRequestContext, Config, GuidString, Id64String, Logger, LogLevel } from "@bentley/bentleyjs-core";
import { AuthorizedBackendRequestContext, BriefcaseDb, BriefcaseManager, IModelHost, NativeHost } from "@bentley/imodeljs-backend";
import { TestUserCredentials, getTestAccessToken, TestBrowserAuthorizationClientConfiguration } from "@bentley/oidc-signin-tool";
import { ElectronAuthorizationBackend } from "@bentley/electron-manager/lib/ElectronBackend";
import { LocalBriefcaseProps, NativeAppAuthorizationConfiguration, OpenBriefcaseProps } from "@bentley/imodeljs-common";
import { AccessToken, AuthorizedClientRequestContext } from "@bentley/itwin-client";
import { HubIModel } from "@bentley/imodelhub-client";
import { LogCategory } from "./LogCategory";
import { DataConnection, LoaderClass } from "./loaders";
import * as path from "path";
import * as utils from "./Utils";

// QA and Dev are for Bentley Developer only
export enum Environment {
  Prod = 0,
  QA = 102,
  Dev = 103,
}

export interface JobArgsProps {
  connectorPath: string;
  con: DataConnection;
  loaderClass: LoaderClass;
  subjectName?: string;
  outputDir?: string;
  readonly logLevel?: LogLevel;
  enableDelete?: boolean;
  revisionHeader?: string;
}

export class JobArgs implements JobArgsProps {
  // relative path to compiler connector module (.js)
  public connectorPath: string;
  // used to connect to source data
  public con: DataConnection;
  // choose an available loader to use. you can also point this to your own Loader.
  public loaderClass: LoaderClass;
  // dataConnection.filepath is used if undefined.
  public subjectName: string;
  // relative path to the directory for storing output files
  public outputDir: string = path.join(__dirname, "output");
  // change log level to debug your connector (rarely needed)
  public readonly logLevel: LogLevel = LogLevel.None;
  // allows elements to be deleted if they no longer exist in the source file. (only works for BriefcaseDb)
  public enableDelete: boolean = true;
  // header of save/push comments.
  public revisionHeader: string = "itwin-pcf";

  constructor(props: JobArgsProps) {
    this.connectorPath = props.connectorPath;
    this.con = props.con;
    this.loaderClass = props.loaderClass;
    if (props.subjectName !== undefined)
      this.subjectName = props.subjectName;
    else
      this.subjectName = props.con.filepath;
    if (props.outputDir)
      this.outputDir = props.outputDir;
    if (props.logLevel !== undefined)
      this.logLevel = props.logLevel;
    if (props.logLevel !== undefined)
      this.logLevel = props.logLevel;
    if (props.enableDelete !== undefined)
      this.enableDelete = props.enableDelete;
    if (props.revisionHeader !== undefined)
      this.revisionHeader = props.revisionHeader;
  }
}

export interface HubArgsProps {
  projectId: Id64String;
  iModelId: Id64String;
  clientConfig: NativeAppAuthorizationConfiguration;
  env?: Environment;
}

export class HubArgs implements HubArgsProps {
  // your project's GUID ID
  public projectId: Id64String;
  // your iModel's GUID ID
  public iModelId: Id64String;
  // you may obtain client configurations from https://developer.bentley.com by creating a SPA app
  public clientConfig: NativeAppAuthorizationConfiguration;
  // do not override this value if you're not a Bentley developer.
  public readonly env: Environment = Environment.Prod;

  public updateDbProfile: boolean = false;
  public updateDomainSchemas: boolean = false;

  constructor(props: HubArgsProps) {
    this.projectId = props.projectId;
    this.iModelId = props.iModelId;
    this.clientConfig = props.clientConfig;
    if (props.env !== undefined)
      this.env = props.env;
  }
}

/*
 * The driver for your entire connector program.
 * BaseApp takes care of all the prerequisites to run your connector.
 */
export class BaseApp {

  public jobArgs: JobArgs;
  public hubArgs: HubArgs;
  protected _authReqContext?: AuthorizedClientRequestContext;

  public get authReqContext() {
    if (!this._authReqContext)
      throw new Error("not signed in");
    return this._authReqContext;
  }

  constructor(jobArgs: JobArgs, hubArgs: HubArgs) {
    this.hubArgs = hubArgs;
    this.jobArgs = jobArgs;

    const envStr = String(this.hubArgs.env);
    Config.App.set("imjs_buddi_resolve_url_using_region", envStr);

    const defaultLevel = this.jobArgs.logLevel;
    Logger.initializeToConsole();
    Logger.configureLevels({
      defaultLevel: LogLevel[defaultLevel],
      categoryLevels: [
        {
          category: LogCategory.PCF,
          logLevel: LogLevel[LogLevel.Info],
        },
      ]
    });
  }

  /*
   * Safely executes a connector job to synchronizer a BriefcaseDb.
   */
  public async run(): Promise<BentleyStatus> {
    let db: BriefcaseDb | undefined = undefined;
    await IModelHost.startup();
    await this.signin();
    try {
      db = await this.openBriefcaseDb();
      const connector = require(this.jobArgs.connectorPath).default;
      await connector.runJob({ db, jobArgs: this.jobArgs, authReqContext: this.authReqContext });
    } catch(err) {
      console.error(err);
      if ((err as any).status === 403) // out of call volumn quota
        return BentleyStatus.ERROR;
      await utils.retryLoop(async () => {
        if (db && db.isBriefcaseDb()) {
          await db.concurrencyControl.abandonResources(this.authReqContext);
        }
      });
      return BentleyStatus.ERROR;
    } finally {
      if (db)
        db.close();
      await IModelHost.shutdown();
    }
    return BentleyStatus.SUCCESS;
  }

  /*
   * Sign in through your iModelHub account. This call would open up a page in your browser and prompt you to sign in.
   */
  public async signin(): Promise<AuthorizedBackendRequestContext> {
    if (this._authReqContext)
      return this._authReqContext;
    const token = await this.getToken();
    this._authReqContext = new AuthorizedBackendRequestContext(token);
    return this._authReqContext;
  }

  public async getToken(): Promise<AccessToken> {
    const client = new ElectronAuthorizationBackend();
    await client.initialize(this.hubArgs.clientConfig);

    return new Promise<AccessToken>((resolve, reject) => {
      NativeHost.onUserStateChanged.addListener((token) => {
        if (token !== undefined)
          resolve(token);
        else
          reject(new Error("Failed to sign in"));
      });
      client.signIn().catch((err) => reject(err));
    });
  }

  /*
   * Open a previously downloaded BriefcaseDb on disk if present.
   */
  public async openCachedBriefcaseDb(readonlyMode: boolean = true): Promise<BriefcaseDb | undefined> {
    if (!this.hubArgs)
      throw new Error("hubArgs is undefined")

    const briefcases = BriefcaseManager.getCachedBriefcases(this.hubArgs.iModelId);
    const briefcaseEntry = briefcases[0];
    if (briefcaseEntry === undefined)
      return undefined;

    const briefcase = await BriefcaseDb.open(new ClientRequestContext(), {
      fileName: briefcases[0].fileName,
      readonly: readonlyMode,
    });

    return briefcase;
  }

  /*
   * Downloads and opens a BriefcaseDb from iModel Hub.
   */
  public async openBriefcaseDb(): Promise<BriefcaseDb> {

    // TODO enable this later
    // const cachedDb = await this.openCachedBriefcaseDb(false);
    // if (cachedDb) {
    //   await cachedDb.pullAndMergeChanges(this.authReqContext);
    //   cachedDb.saveChanges();
    //   return cachedDb;
    // }

    const req = { contextId: this.hubArgs.projectId, iModelId: this.hubArgs.iModelId };
    const bcProps: LocalBriefcaseProps = await BriefcaseManager.downloadBriefcase(this.authReqContext, req);

    if (this.hubArgs.updateDbProfile || this.hubArgs.updateDomainSchemas)
      await BriefcaseDb.upgradeSchemas(this.authReqContext, bcProps);

    const openArgs: OpenBriefcaseProps = { fileName: bcProps.fileName };
    const db = await BriefcaseDb.open(this.authReqContext, openArgs);
    return db!;
  }
}

export class TestHubArgs extends HubArgs {
  public env: Environment = Environment.QA;
  public logLevel: LogLevel = LogLevel.Error;
  constructor(props: { projectId: Id64String, iModelId: Id64String, clientConfig: NativeAppAuthorizationConfiguration }) {
    super(props);
  }
}

/*
 * extend/utilize this class to create your own integration tests
 */
export class IntegrationTestApp extends BaseApp {

  protected _testBriefcaseDbPath?: string;
  public jobArgs: JobArgs;
  public hubArgs: TestHubArgs;

  constructor(testJobArgs: JobArgs, testHubArgs: TestHubArgs) {
    super(testJobArgs as JobArgs, testHubArgs as HubArgs);
    this.jobArgs = testJobArgs;
    this.hubArgs = testHubArgs;
  }

  /*
   * Sign in through your iModelHub test user account. This call would grab your use credentials from environment variables.
   */
  public async signin(): Promise<AuthorizedBackendRequestContext> {
    const email = process.env.imjs_test_regular_user_name;
    const password = process.env.imjs_test_regular_user_password;
    if (email && password) {
      const cred: TestUserCredentials = { email, password };
      const token = await getTestAccessToken(this.hubArgs.clientConfig as TestBrowserAuthorizationClientConfiguration, cred, this.hubArgs.env);
      this._authReqContext = new AuthorizedBackendRequestContext(token);
    } else {
      throw new Error("Specify imjs_test_regular_user_name & imjs_test_regular_user_password env variables to enable slient sign-in.");
    }
    return this._authReqContext;
  }

  public async openBriefcaseDb(): Promise<BriefcaseDb> {
    if (this._testBriefcaseDbPath)
      await BriefcaseManager.deleteBriefcaseFiles(this._testBriefcaseDbPath, this.authReqContext);
    let db: BriefcaseDb | undefined = undefined;
    await utils.retryLoop(async () => {
      db = await super.openBriefcaseDb();
      this._testBriefcaseDbPath = db.pathName;
    })
    if (!db)
      throw new Error("Failed to open test BriefcaseDb");
    return db;
  }

  public async createTestBriefcaseDb(): Promise<GuidString> {
    // TODO delete existing if present
    const testIModelName = `Integration Test IModel (${process.platform})`;
    const iModel: HubIModel = await IModelHost.iModelClient.iModels.create(this.authReqContext, this.hubArgs.projectId, testIModelName, { description: `Description for ${testIModelName}` });
    const testIModelId = iModel.wsgId;
    this.hubArgs.iModelId = testIModelId;
    return testIModelId;
  }

  public async purgeTestBriefcaseDb(): Promise<void> {
    await utils.retryLoop(async () => {
      await IModelHost.iModelClient.iModels.delete(this.authReqContext, this.hubArgs.projectId, this.hubArgs.iModelId);
    });
    if (this._testBriefcaseDbPath)
      await BriefcaseManager.deleteBriefcaseFiles(this._testBriefcaseDbPath, this.authReqContext);
  }
}
