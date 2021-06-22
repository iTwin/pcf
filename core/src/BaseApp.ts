import { ClientRequestContext, Config, GuidString, Id64String, Logger, LogLevel } from "@bentley/bentleyjs-core";
import { AuthorizedBackendRequestContext, BriefcaseDb, BriefcaseManager, IModelDb, IModelHost, NativeHost } from "@bentley/imodeljs-backend";
import { TestUserCredentials, getTestAccessToken, TestBrowserAuthorizationClientConfiguration } from "@bentley/oidc-signin-tool";
import { ElectronAuthorizationBackend } from "@bentley/electron-manager/lib/ElectronBackend";
import { LocalBriefcaseProps, NativeAppAuthorizationConfiguration, OpenBriefcaseProps } from "@bentley/imodeljs-common";
import { AccessToken } from "@bentley/itwin-client";
import { HubIModel } from "@bentley/imodelhub-client";
import { LogCategory } from "./LogCategory";
import { DataConnection, Loader, LoaderClass } from "./drivers";
import * as path from "path";

// QA and Dev are for Bentley Developer only
export enum Environment {
  Prod = 0,
  QA = 102,
  Dev = 103,
}

export class JobArgs {
  // relative path to compiler connector module (.js)
  public connectorPath: string;
  // used to connect to source data
  public con: DataConnection;
  // dataConnection.filepath is used if undefined.
  public subjectName: string;
  // relative path to the directory for storing output files
  public outputDir: string = path.join(__dirname, "output");
  // change log level to debug your connector (rarely needed)
  public logLevel: LogLevel = LogLevel.None;
  // allows elements to be deleted if they no longer exist in the source file. (only works for BriefcaseDb)
  public enableDelete: boolean = true;
  // header of save/push comments.
  public revisionHeader: string = "itwin-pcf";
  // choose an available loader to use. you can also point this to your own Loader.
  public loaderClass: LoaderClass;

  constructor(props: { connectorPath: string, con: DataConnection, loaderClass: LoaderClass, subjectName?: string, outputDir?: string, logLevel?: LogLevel, doDetectDeletedElements?: boolean, revisionHeader?: string }) {
    this.connectorPath = props.connectorPath;
    this.con = props.con;
    this.subjectName = props.subjectName ?? props.con.filepath;
    this.loaderClass = props.loaderClass;
  }
}

export class HubArgs {
  // your project's GUID ID
  public projectId: Id64String;
  // your iModel's GUID ID
  public iModelId: Id64String;
  // you may obtain client configurations from https://developer.bentley.com by creating a SPA app
  public clientConfig: NativeAppAuthorizationConfiguration;
  // do not override this value if you're not a Bentley developer.
  public env: Environment = Environment.Prod;

  public updateDbProfile: boolean = false;
  public updateDomainSchemas: boolean = false;

  constructor(props: { projectId: Id64String, iModelId: Id64String, clientConfig: NativeAppAuthorizationConfiguration, env?: Environment }) {
    this.projectId = props.projectId;
    this.iModelId = props.iModelId;
    this.clientConfig = props.clientConfig;
  }
}

/*
 * The driver for your entire connector program.
 * BaseApp takes care of all the prerequisites to run your connector.
 */
export class BaseApp {

  public readonly jobArgs: JobArgs;
  public readonly hubArgs: HubArgs | undefined;
  public reqContext?: AuthorizedBackendRequestContext;

  constructor(jobArgs: JobArgs, hubArgs: HubArgs) {

    this.jobArgs = jobArgs;
    this.hubArgs = hubArgs;

    if (hubArgs) {
      const envStr = String(hubArgs.env);
      Config.App.set("imjs_buddi_resolve_url_using_region", envStr);
    }

    const defaultLevel = jobArgs.logLevel;
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
   * Execute a connector job to synchronizer a BriefcaseDb.
   */
  public async run() {
    const connector = require(this.jobArgs.connectorPath).default;
    const reqContext = await this.signin();
    const db = await this.openBriefcaseDb();
    this.reqContext = reqContext;
    await connector.runJob({ db, jobArgs: this.jobArgs, reqContext });
    db.close();
  }

  /*
   * Sign in through your iModelHub account. This call would open up a page in your browser and prompt you to sign in.
   */
  public async signin() {
    if (this.reqContext)
      return this.reqContext;
    const getToken = async () => {
      if (!this.hubArgs)
        throw new Error("the app is not connected to iModel Hub. no need to sign in.");

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
    const token = await getToken();
    this.reqContext = new AuthorizedBackendRequestContext(token);
    return this.reqContext;
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
    if (!this.hubArgs)
      throw new Error("hubArgs is undefined");
    if (!this.reqContext)
      this.reqContext = await this.signin();

    // TODO enable this later
    // const cachedDb = await this.openCachedBriefcaseDb(false);
    // if (cachedDb) {
    //   await cachedDb.pullAndMergeChanges(this.authReqContext);
    //   cachedDb.saveChanges();
    //   return cachedDb;
    // }

    const req = { contextId: this.hubArgs.projectId, iModelId: this.hubArgs.iModelId };
    const bcProps: LocalBriefcaseProps = await BriefcaseManager.downloadBriefcase(this.reqContext, req);

    if (this.hubArgs.updateDbProfile || this.hubArgs.updateDomainSchemas)
      await BriefcaseDb.upgradeSchemas(this.reqContext, bcProps);

    const openArgs: OpenBriefcaseProps = { fileName: bcProps.fileName };
    const db = await BriefcaseDb.open(this.reqContext, openArgs);
    return db;
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
  public async silentSignin() {
    const email = process.env.imjs_test_regular_user_name;
    const password = process.env.imjs_test_regular_user_password;
    if (email && password) {
      const cred: TestUserCredentials = { email, password };
      const token = await getTestAccessToken(this.hubArgs.clientConfig as TestBrowserAuthorizationClientConfiguration, cred, this.hubArgs.env);
      this.reqContext = new AuthorizedBackendRequestContext(token);
    } else {
      throw new Error("Specify imjs_test_regular_user_name & imjs_test_regular_user_password env variables to enable slient sign-in.");
    }
  }

  public async openBriefcaseDb() {
    if (this._testBriefcaseDbPath)
      await BriefcaseManager.deleteBriefcaseFiles(this._testBriefcaseDbPath, this.reqContext);
    const db = await super.openBriefcaseDb();
    this._testBriefcaseDbPath = db.pathName;
    return db;
  }

  public async createTestBriefcaseDb(): Promise<GuidString> {
    if (!this.reqContext)
      throw new Error("not signed in");

    const testIModelName = `Integration Test IModel (${process.platform})`;
    const iModel: HubIModel = await IModelHost.iModelClient.iModels.create(this.reqContext, this.hubArgs.projectId, testIModelName, { description: `Description for ${testIModelName}` });
    const testIModelId = iModel.wsgId;
    this.hubArgs.iModelId = testIModelId;
    return testIModelId;
  }

  public async purgeTestBriefcaseDb() {
    if (!this.reqContext)
      throw new Error("not signed in");

    await IModelHost.iModelClient.iModels.delete(this.reqContext, this.hubArgs.projectId, this.hubArgs.iModelId);
    if (this._testBriefcaseDbPath)
      await BriefcaseManager.deleteBriefcaseFiles(this._testBriefcaseDbPath, this.reqContext);
  }
}
