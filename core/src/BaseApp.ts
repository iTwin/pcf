import { assert, ClientRequestContext, Config, GuidString, Id64String, Logger, LogLevel } from "@bentley/bentleyjs-core";
import { AuthorizedBackendRequestContext, BriefcaseDb, BriefcaseManager, IModelHost, NativeHost } from "@bentley/imodeljs-backend";
import { TestUserCredentials, getTestAccessToken, TestBrowserAuthorizationClientConfiguration } from "@bentley/oidc-signin-tool";
import { ElectronAuthorizationBackend } from "@bentley/electron-manager/lib/ElectronBackend";
import { LocalBriefcaseProps, NativeAppAuthorizationConfiguration, OpenBriefcaseProps } from "@bentley/imodeljs-common";
import { AccessToken } from "@bentley/itwin-client";
import { HubIModel } from "@bentley/imodelhub-client";
import { LogCategory } from "./LogCategory";
import { FileConnection } from "./drivers";
import * as path from "path";

// QA and Dev are for Bentley Developer only
export enum Environment {
  Prod = 0,
  QA = 102,
  Dev = 103,
}

export interface AppArgs {
  // used to connect to source data
  dataConnection: FileConnection;
  // your project's GUID ID
  projectId: Id64String | GuidString,
  // your iModel's GUID ID
  iModelId: Id64String | GuidString,
  // you may obtain client configurations from https://developer.bentley.com by creating a SPA app
  clientConfig: NativeAppAuthorizationConfiguration;
  // dataConnection.filepath is used if undefined.
  subjectName?: string;
  // relative path to the directory for storing output files
  outputDir?: string;
  // do not override this value if you're not a Bentley developer.
  env?: Environment;
  // change log level to debug your connector (rarely needed)
  logLevel?: LogLevel;
  // header of iModel Hub ChangesSet push comments.
  revisionHeader?: string;
  // allows elements to be deleted if they no longer exist in the source file.
  doDetectDeletedElements?: boolean;
  
  // CURRENTLY DISABLED
  // updateDbProfile?: boolean;
  // updateDomainSchemas?: boolean;
}

export interface BaseTestAppArgs {
  dataConnection: FileConnection,
  outputDir: string,
  projectId: Id64String | GuidString,
  clientConfig: NativeAppAuthorizationConfiguration;
}

/*
 * The driver for your entire connector program.
 * BaseApp takes care of all the prerequisites to run your connector.
 */
export class BaseApp {

  public clientConfig: NativeAppAuthorizationConfiguration;
  public projectId: Id64String;
  public iModelId: Id64String;

  // disable upgrade schemas for now
  public env: Environment = Environment.Prod;
  public logLevel: LogLevel = LogLevel.None;
  public outputDir: string = path.join(__dirname, "output");
  public revisionHeader: string = "itwin-pcf";
  public doDetectDeletedElements: boolean = true;
  public updateDbProfile: boolean = false;
  public updateDomainSchemas: boolean = false;
  public authReqContext?: AuthorizedBackendRequestContext;
  public dataConnection: FileConnection;
  public subjectName: string;

  constructor(args: AppArgs) {
    this.clientConfig = args.clientConfig;
    this.projectId = args.projectId;
    this.iModelId = args.iModelId;
    this.dataConnection = args.dataConnection;

    if (!args.subjectName)
      this.subjectName = args.dataConnection.filepath;
    else
      this.subjectName = args.subjectName

    if (args.outputDir)
      this.outputDir = args.outputDir;
    if (args.env)
      this.env = args.env;
    if (args.logLevel)
      this.logLevel = args.logLevel;
    if (args.revisionHeader)
      this.revisionHeader = args.revisionHeader;
    if (args.doDetectDeletedElements)
      this.doDetectDeletedElements = args.doDetectDeletedElements;

    const envStr = String(this.env);
    Config.App.set("imjs_buddi_resolve_url_using_region", envStr);

    const defaultLevel = this.logLevel ?? LogLevel.None;
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
   * Sign in through your iModelHub account. This call would open up a page in your browser and prompt you to sign in.
   */
  public async signin() {
    const getToken = async () => {
      const client = new ElectronAuthorizationBackend();
      await client.initialize(this.clientConfig);

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
    const email = process.env.imjs_test_regular_user_name;
    const password = process.env.imjs_test_regular_user_password;
    if (email && password) {
      const cred: TestUserCredentials = { email, password };
      const token = await getTestAccessToken(this.clientConfig as TestBrowserAuthorizationClientConfiguration, cred, this.env);
      this.authReqContext = new AuthorizedBackendRequestContext(token);
    } else {
      throw new Error("Specify imjs_test_regular_user_name & imjs_test_regular_user_password env variables to enable slient sign-in.");
    }
  }

  public async openCachedBriefcaseDb(readonlyMode: boolean = true): Promise<BriefcaseDb | undefined> {
    const briefcases = BriefcaseManager.getCachedBriefcases(this.iModelId);
    const briefcaseEntry = briefcases[0];
    if (briefcaseEntry === undefined)
      return undefined;

    const briefcase = await BriefcaseDb.open(new ClientRequestContext(), {
      fileName: briefcases[0].fileName,
      readonly: readonlyMode,
    });

    return briefcase;
  }

  public async downloadBriefcaseDb(): Promise<BriefcaseDb> {
    if (!this.authReqContext)
      throw new Error("must call signin() before downloading a BriefcaseDb.");

    // TODO enable this later
    // const cachedDb = await this.openCachedBriefcaseDb(false);
    // if (cachedDb) {
    //   await cachedDb.pullAndMergeChanges(this.authReqContext);
    //   cachedDb.saveChanges();
    //   return cachedDb;
    // }

    const req = { contextId: this.projectId, iModelId: this.iModelId };
    const bcProps: LocalBriefcaseProps = await BriefcaseManager.downloadBriefcase(this.authReqContext, req);

    if (this.updateDbProfile || this.updateDomainSchemas)
      await BriefcaseDb.upgradeSchemas(this.authReqContext, bcProps);

    const openArgs: OpenBriefcaseProps = { fileName: bcProps.fileName };
    const db = await BriefcaseDb.open(this.authReqContext, openArgs);
    return db;
  }
}

/*
 * extend this class to create your own tests
 */
export class BaseTestApp extends BaseApp {

  public env: Environment = Environment.QA;
  public logLevel: LogLevel = LogLevel.Error;
  protected _testBriefcaseDbPath?: string;

  constructor(args: BaseTestAppArgs) {
    super(args as AppArgs);
    this.env = Environment.QA;
    this.logLevel = LogLevel.Error;
  }

  public async downloadBriefcaseDb() {
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
    const iModel: HubIModel = await IModelHost.iModelClient.iModels.create(this.authReqContext, this.projectId, testIModelName, { description: `Description for ${testIModelName}` });
    const testIModelId = iModel.wsgId;
    assert(undefined !== testIModelId);
    this.iModelId = testIModelId;
    return testIModelId;
  }

  public async purgeTestBriefcaseDb() {
    if (!this.authReqContext)
      throw new Error("not signed in");

    await IModelHost.iModelClient.iModels.delete(this.authReqContext, this.projectId, this.iModelId);
    if (this._testBriefcaseDbPath)
      await BriefcaseManager.deleteBriefcaseFiles(this._testBriefcaseDbPath, this.authReqContext);
  }
}
