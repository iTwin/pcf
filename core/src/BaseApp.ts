import { assert, ClientRequestContext, Config, GuidString, Id64, Id64String, Logger, LogLevel } from "@bentley/bentleyjs-core";
import { AuthorizedBackendRequestContext, BackendRequestContext, BriefcaseDb, BriefcaseManager, IModelDb, IModelHost, NativeHost } from "@bentley/imodeljs-backend";
import { TestUserCredentials, getTestAccessToken, TestBrowserAuthorizationClientConfiguration } from "@bentley/oidc-signin-tool";
import { ElectronAuthorizationBackend } from "@bentley/electron-manager/lib/ElectronBackend";
import { LocalBriefcaseProps, NativeAppAuthorizationConfiguration, OpenBriefcaseProps } from "@bentley/imodeljs-common";
import { AccessToken } from "@bentley/itwin-client";
import { HubIModel } from "@bentley/imodelhub-client";
import { LogCategory } from "./LogCategory";
import { DataConnection, Loader } from "./drivers";
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
  // allows elements to be deleted if they no longer exist in the source file.
  public enableDelete: boolean = true;
  // header of save/push comments.
  public revisionHeader: string = "itwin-pcf";

  constructor(props: { connectorPath: string, con: DataConnection, subjectName?: string, outputDir?: string, logLevel?: LogLevel, doDetectDeletedElements?: boolean, revisionHeader?: string }) {
    this.connectorPath = props.connectorPath;
    this.con = props.con;
    this.subjectName = props.subjectName ?? props.con.filepath;
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
    if (!Id64.isInvalid(this.projectId))
      throw new Error("invalid project id");
    if (!Id64.isInvalid(this.iModelId))
      throw new Error("invalid iModel id");
  }
}

/*
 * The driver for your entire connector program.
 * BaseApp takes care of all the prerequisites to run your connector.
 */
export class BaseApp {

  public readonly jobArgs: JobArgs;
  public readonly hubArgs?: HubArgs | undefined;
  public authReqContext?: AuthorizedBackendRequestContext;

  constructor(jobArgs: JobArgs, hubArgs?: HubArgs) {

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
   * Execute a connector job.
   */
  public async run(db: IModelDb, loader: Loader) {
    const connector = require(this.jobArgs.connectorPath).default;
    let reqContext = new BackendRequestContext();
    if (db instanceof BriefcaseDb) {
      if (!this.authReqContext)
        throw new Error("not signed in");
      reqContext = this.authReqContext;
    }
    await connector.runJob({
      db,
      loader,
      reqContext,
      revisionHeader: this.jobArgs.revisionHeader,
      dataConnection: this.jobArgs.con,
      subjectName: this.jobArgs.subjectName,
    });
  }

  /*
   * Sign in through your iModelHub account. This call would open up a page in your browser and prompt you to sign in.
   */
  public async signin() {
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
    this.authReqContext = new AuthorizedBackendRequestContext(token);
    return this.authReqContext;
  }

  /*
   * Sign in through your iModelHub account. This call would grab your use credentials from environment variables.
   */
  public async silentSignin() {
    if (!this.hubArgs)
      throw new Error("the app is not connected to iModel Hub. no need to sign in.");
    const email = process.env.imjs_test_regular_user_name;
    const password = process.env.imjs_test_regular_user_password;
    if (email && password) {
      const cred: TestUserCredentials = { email, password };
      const token = await getTestAccessToken(this.hubArgs.clientConfig as TestBrowserAuthorizationClientConfiguration, cred, this.hubArgs.env);
      this.authReqContext = new AuthorizedBackendRequestContext(token);
    } else {
      throw new Error("Specify imjs_test_regular_user_name & imjs_test_regular_user_password env variables to enable slient sign-in.");
    }
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
   * Downloads a BriefcaseDb from iModel Hub.
   */
  public async downloadBriefcaseDb(): Promise<BriefcaseDb> {
    if (!this.hubArgs)
      throw new Error("hubArgs is undefined");
    if (!this.authReqContext)
      throw new Error("must call signin() before downloading a BriefcaseDb.");

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
    return db;
  }
}

export class IntegrationTestArgs {
  public projectId: Id64String;
  public clientConfig: NativeAppAuthorizationConfiguration;
  public env: Environment = Environment.QA;
  public logLevel: LogLevel = LogLevel.Error;
  constructor(props: { projectId: Id64String, clientConfig: NativeAppAuthorizationConfiguration }) {
    this.projectId = props.projectId;
    this.clientConfig = props.clientConfig;
  }
}

/*
 * extend/utilize this class to create your own integration tests
 */
export class IntegrationTestApp extends BaseApp {

  protected _testBriefcaseDbPath?: string;
  public testHubArgs: IntegrationTestArgs;
  public testIModelId?: Id64String;

  constructor(testJobArgs: JobArgs, testArgs: IntegrationTestArgs) {
    super(testJobArgs as JobArgs);
    this.testHubArgs = testArgs;
  }

  public async downloadTestBriefcaseDb() {
    if (this._testBriefcaseDbPath)
      await BriefcaseManager.deleteBriefcaseFiles(this._testBriefcaseDbPath, this.authReqContext);
    const db = await super.downloadBriefcaseDb();
    this._testBriefcaseDbPath = db.pathName;
    return db;
  }

  public async createTestBriefcaseDb(): Promise<GuidString> {
    if (!this.authReqContext)
      throw new Error("not signed in");

    const testIModelName = `Integration Test IModel (${process.platform})`;
    const iModel: HubIModel = await IModelHost.iModelClient.iModels.create(this.authReqContext, this.testHubArgs.projectId, testIModelName, { description: `Description for ${testIModelName}` });
    const testIModelId = iModel.wsgId;
    assert(undefined !== testIModelId);
    this.testIModelId = testIModelId;
    return testIModelId;
  }

  public async purgeTestBriefcaseDb() {
    if (!this.authReqContext)
      throw new Error("not signed in");

    await IModelHost.iModelClient.iModels.delete(this.authReqContext, this.testHubArgs.projectId, this.testIModelId!);
    if (this._testBriefcaseDbPath)
      await BriefcaseManager.deleteBriefcaseFiles(this._testBriefcaseDbPath, this.authReqContext);
  }
}
