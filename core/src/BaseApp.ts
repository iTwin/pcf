import { BentleyStatus, Config, GuidString, Id64String, Logger, LogLevel } from "@bentley/bentleyjs-core";
import { AuthorizedBackendRequestContext, StandaloneDb, BriefcaseDb, BriefcaseManager, IModelHost, NativeHost } from "@bentley/imodeljs-backend";
import { TestUserCredentials, getTestAccessToken, TestBrowserAuthorizationClientConfiguration } from "@bentley/oidc-signin-tool";
import { ElectronAuthorizationBackend } from "@bentley/electron-manager/lib/ElectronBackend";
import { LocalBriefcaseProps, NativeAppAuthorizationConfiguration, OpenBriefcaseProps } from "@bentley/imodeljs-common";
import { AccessToken, AuthorizedClientRequestContext } from "@bentley/itwin-client";
import { HubIModel, IModelQuery } from "@bentley/imodelhub-client";
import { LogCategory } from "./LogCategory";
import { DataConnection } from "./loaders";
import * as path from "path";
import * as util from "./Util";

export enum Environment {
  Prod = 0,

  // QA and Dev are for Bentley Developer only
  QA = 102,
  Dev = 103,
}

export interface JobArgsProps {

  /* 
   * relative path to compiler connector module (.js)
   */
  connectorPath: string;

  /*
   * info needed to connect to source data
   */
  connection: DataConnection;

  /*
   * subjectKey references an existing subject node defined in your connector and uniquely identifies 
   * a subject element in an iModel. pcf will synchronize all the data stored under this subject 
   * with source file.
   */
  subjectKey: string;

  /*
   * absolute path to the directory for storing output files like cached Briefcase.
   */
  outputDir?: string;

  /*
   * change log level to debug your connector (rarely needed)
   */
  logLevel?: LogLevel;

  /* 
   * allows elements to be deleted if they no longer exist in the source file. For a BriefcaseDb, only
   * elements in the current subject channel can be deleted.
   */
  enableDelete?: boolean;

  /*
   * header of save/push comments. Push Comment = "<revisionHeader> - <your comment>".
   */
  revisionHeader?: string;
}

export class JobArgs implements JobArgsProps {
  public connectorPath: string;
  public connection: DataConnection;
  public subjectKey: string;
  public outputDir: string = path.join(__dirname, "output");
  public logLevel: LogLevel = LogLevel.None;
  public enableDelete: boolean = true;
  public revisionHeader: string = "itwin-pcf";

  constructor(props: JobArgsProps) {
    this.connectorPath = props.connectorPath;
    this.connection = props.connection;
    this.subjectKey = props.subjectKey;
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
  /*
   * your project GUID (it's also called "contextId")
   */
  projectId: Id64String;

  /*
   * your iModel GUID 
   */
  iModelId: Id64String;

  /* 
   * you may acquire client configurations from https://developer.bentley.com by creating a SPA app
   */
  clientConfig: NativeAppAuthorizationConfiguration;

  /* 
   * Only Bentley developers could override this value for testing. Do not override it in production.
   */
  env?: Environment;
}

export class HubArgs implements HubArgsProps {
  public projectId: Id64String;
  public iModelId: Id64String;
  public clientConfig: NativeAppAuthorizationConfiguration;
  public env: Environment = Environment.Prod;
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
    this.init();
  }

  /*
   * initialize app settings based on current jobArgs and hubArgs. every public method should call this first.
   */
  public init() {
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
   * Safely executes a connector job to synchronize a BriefcaseDb.
   */
  public async run(): Promise<BentleyStatus> {
    this.init();
    let db: BriefcaseDb | undefined = undefined;
    await IModelHost.startup();
    await this.signin();
    try {
      db = await this.openBriefcaseDb();
      const connector = require(this.jobArgs.connectorPath).default();
      connector.init({ db, jobArgs: this.jobArgs, authReqContext: this.authReqContext });
      await connector.runJob();
    } catch(err) {
      console.error(err);
      if ((err as any).status === 403) // out of call volumn quota
        return BentleyStatus.ERROR;
      await util.retryLoop(async () => {
        if (db && db.isBriefcaseDb()) {
          await db.concurrencyControl.abandonResources(this.authReqContext);
        }
      });
      return BentleyStatus.ERROR;
    } finally {
      if (db) {
        db.abandonChanges();
        db.close();
      }
      await IModelHost.shutdown();
    }
    return BentleyStatus.SUCCESS;
  }

  /*
   * Sign in through your iModelHub account. This call would open up a page in your browser and prompt you to sign in.
   */
  public async signin(): Promise<AuthorizedBackendRequestContext> {
    this.init();
    if (this._authReqContext)
      return this._authReqContext;
    const token = await this.getToken();
    this._authReqContext = new AuthorizedBackendRequestContext(token);
    return this._authReqContext;
  }

  public async getToken(): Promise<AccessToken> {
    this.init();
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
    this.init();

    const cachedDbs = BriefcaseManager.getCachedBriefcases(this.hubArgs.iModelId);
    const cachedDb = cachedDbs[0];
    if (!cachedDb)
      return undefined;

    const db = await BriefcaseDb.open(this.authReqContext, {
      fileName: cachedDb.fileName,
      readonly: readonlyMode,
    });
    await db.pullAndMergeChanges(this.authReqContext);
    db.saveChanges();
    return db;
  }

  /*
   * Downloads and opens a BriefcaseDb from iModel Hub.
   */
  public async openBriefcaseDb(): Promise<BriefcaseDb> {
    this.init();

    const cachedDb = await this.openCachedBriefcaseDb(false);
    if (cachedDb)
      return cachedDb;

    const req = { contextId: this.hubArgs.projectId, iModelId: this.hubArgs.iModelId };
    const bcProps: LocalBriefcaseProps = await BriefcaseManager.downloadBriefcase(this.authReqContext, req);

    if (this.hubArgs.updateDbProfile || this.hubArgs.updateDomainSchemas)
      await BriefcaseDb.upgradeSchemas(this.authReqContext, bcProps);

    const openArgs: OpenBriefcaseProps = { fileName: bcProps.fileName };
    const db = await BriefcaseDb.open(this.authReqContext, openArgs);
    return db;
  }

  public static repl(dbpath: string) {
    const readline = require("readline");
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    const db = StandaloneDb.openFile(dbpath);
    while (true) {
      rl.question("$: ", function(input: string) {
        if (input === "exit")
          return;
        util.getRows(db, input);
      });
    }
  }
}

/*
 * extend/utilize this class to create your own integration tests
 */
export class IntegrationTestApp extends BaseApp {

  protected _testBriefcaseDbPath?: string;

  constructor(testJobArgs: JobArgs) {
    const projectId = process.env.imjs_test_project_id;
    const clientId = process.env.imjs_test_client_id;
    if (!projectId)
      throw new Error("environment variable 'imjs_test_project_id' is not defined");
    if (!clientId)
      throw new Error("environment variable 'imjs_test_client_id' is not defined");
    const testHubArgs = new HubArgs({
      projectId,
      iModelId: "not used",
      clientConfig: {
        clientId,
        redirectUri: "http://localhost:3000/signin-callback",
        scope: "connections:read connections:modify realitydata:read imodels:read imodels:modify library:read storage:read storage:modify openid email profile organization imodelhub context-registry-service:read-only product-settings-service general-purpose-imodeljs-backend imodeljs-router urlps-third-party projectwise-share rbac-user:external-client projects:read projects:modify validation:read validation:modify issues:read issues:modify forms:read forms:modify",
      },
      env: Environment.QA,
    });
    testJobArgs.logLevel = LogLevel.Error;
    super(testJobArgs, testHubArgs);
    this.jobArgs = testJobArgs;
    this.hubArgs = testHubArgs;
    this.init();
  }

  /*
   * Sign in through your iModelHub test user account. This call would grab your test user credentials from environment variables.
   */
  public async silentSignin(): Promise<AuthorizedBackendRequestContext> {
    this.init();
    const email = process.env.imjs_test_regular_user_name;
    const password = process.env.imjs_test_regular_user_password;
    if (!email)
      throw new Error("environment variable 'imjs_test_regular_user_name' is not defined for silent signin");
    if (!password)
      throw new Error("environment variable 'imjs_test_regular_user_password' is not defined for silent signin");
    const cred: TestUserCredentials = { email, password };
    const token = await getTestAccessToken(this.hubArgs.clientConfig as TestBrowserAuthorizationClientConfiguration, cred, this.hubArgs.env);
    this._authReqContext = new AuthorizedBackendRequestContext(token);
    return this._authReqContext;
  }

  public async openBriefcaseDb(): Promise<BriefcaseDb> {
    this.init();
    if (this._testBriefcaseDbPath)
      await BriefcaseManager.deleteBriefcaseFiles(this._testBriefcaseDbPath, this.authReqContext);
    let db: BriefcaseDb | undefined = undefined;
    await util.retryLoop(async () => {
      db = await super.openBriefcaseDb();
      this._testBriefcaseDbPath = db.pathName;
    })
    if (!db)
      throw new Error("Failed to open test BriefcaseDb");
    return db;
  }

  public async createTestBriefcaseDb(): Promise<GuidString> {
    this.init();
    const testIModelName = `Integration Test (${process.platform})`;
    const existingTestIModels: HubIModel[] = await IModelHost.iModelClient.iModels.get(this.authReqContext, this.hubArgs.projectId, new IModelQuery().byName(testIModelName));
    for (const testIModel of existingTestIModels) {
      await util.retryLoop(async () => {
        await IModelHost.iModelClient.iModels.delete(this.authReqContext, this.hubArgs.projectId, testIModel.wsgId);
      });
    }
    const iModel: HubIModel = await IModelHost.iModelClient.iModels.create(this.authReqContext, this.hubArgs.projectId, testIModelName, { description: `Description for ${testIModelName}` });
    const testIModelId = iModel.wsgId;
    this.hubArgs.iModelId = testIModelId;
    return testIModelId;
  }

  public async purgeTestBriefcaseDb(): Promise<void> {
    this.init();
    await util.retryLoop(async () => {
      await IModelHost.iModelClient.iModels.delete(this.authReqContext, this.hubArgs.projectId, this.hubArgs.iModelId);
    });
    if (this._testBriefcaseDbPath)
      await BriefcaseManager.deleteBriefcaseFiles(this._testBriefcaseDbPath, this.authReqContext);
  }
}
