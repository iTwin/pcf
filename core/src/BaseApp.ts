import { assert, ClientRequestContext, Config, GuidString, Id64String, Logger, LogLevel } from "@bentley/bentleyjs-core";
import { AuthorizedBackendRequestContext, BackendRequestContext, BriefcaseDb, BriefcaseManager, IModelHost, NativeHost, SnapshotDb, StandaloneDb } from "@bentley/imodeljs-backend";
import { ElectronAuthorizationBackend } from "@bentley/electron-manager/lib/ElectronBackend";
import { LocalBriefcaseProps, NativeAppAuthorizationConfiguration, OpenBriefcaseProps } from "@bentley/imodeljs-common";
import { AccessToken } from "@bentley/itwin-client";
import { HubIModel } from "@bentley/imodelhub-client";
import { LogCategory } from "./LogCategory";
import { Synchronizer } from "./fwk/Synchronizer";
import { PConnector } from "./PConnector";
import { LoaderConnection } from "./drivers";
import * as path from "path";

// QA and Dev are for Bentley Developer only
export enum Environment {
  Prod = 0,
  QA = 102,
  Dev = 103,
}

export interface BaseAppConfig {
  // relative path to your 'compiled' javascript (.js) connector module.
  connectorModulePath: string,
  // used to connect to source data
  loaderConnection: LoaderConnection;
  // your project's GUID ID 
  projectId: Id64String | GuidString, 
  // your iModel's GUID ID 
  iModelId: Id64String | GuidString,
  // you may obtain client configurations from https://developer.bentley.com by creating a SPA app
  clientConfig: NativeAppAuthorizationConfiguration;
  // relative path to the directory for storing output files
  outputDir?: string;
  // do not override this value if you're not a Bentley developer.
  env?: Environment;
  // change log level to debug your connector (rarely needed)
  logLevel?: LogLevel;

  revisionHeader?: string;

  doDetectDeletedElements?: boolean;

  updateDbProfile?: boolean;

  updateDomainSchemas?: boolean;
}

export interface BaseTestAppConfig {
  connectorModulePath: string, 
  loaderConnection: LoaderConnection,
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
  public connectorModulePath: string;
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
  public loaderConnection: LoaderConnection;

  constructor(config: BaseAppConfig) {
    this.clientConfig = config.clientConfig;
    this.connectorModulePath = config.connectorModulePath;
    this.projectId = config.projectId;
    this.iModelId = config.iModelId;
    this.loaderConnection = config.loaderConnection;
    if (config.outputDir)
      this.outputDir = config.outputDir;
    if (config.env)
      this.env = config.env;
    if (config.logLevel)
      this.logLevel = config.logLevel;
    if (config.revisionHeader)
      this.revisionHeader = config.revisionHeader;
    if (config.doDetectDeletedElements)
      this.doDetectDeletedElements = config.doDetectDeletedElements;
    if (config.updateDbProfile)
      this.updateDbProfile = config.updateDbProfile;
    if (config.updateDomainSchemas)
      this.updateDomainSchemas = config.updateDomainSchemas;
  }

  /*
   * a single call that executes your connector
   */
  public async run() {
    await this.startup();
    await this.signin();
    await this.syncBriefcaseDb();
    await this.shutdown();
  }

  public async startup() {
    await IModelHost.startup();

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

  public async shutdown() {
    await IModelHost.shutdown();
  }

  /*
   * Sign in through your iModelHub account. This call would open up a page in your browser.
   */
  public async signin() {
    const token = await this._signIn();
    this.authReqContext = new AuthorizedBackendRequestContext(token);
  }

  protected async _signIn(): Promise<AccessToken> {
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

  /*
   * Executes a connector synchronization job
   */
  public async sync(db: BriefcaseDb | SnapshotDb | StandaloneDb) {

    const connector = this.loadConnector();

    if (db instanceof BriefcaseDb) {
      if (!this.authReqContext)
        throw new Error("must call signin() before synchronizing a BriefcaseDb.");
      connector.reqContext = this.authReqContext;
      connector.synchronizer = new Synchronizer(db, false, this.authReqContext);
    } else {
      connector.synchronizer = new Synchronizer(db, false);
    }

    const jobSubjectName = "abcd"; // TODO USE LOADER to get this value;
    await connector.updateJobSubject(jobSubjectName);
    await connector.updateDomainSchema();
    await connector.updateDynamicSchema();
    await connector.updateData();
    await connector.updateProjectExtents();
  }

  public async syncBriefcaseDb() {
    const db = await this.downloadBriefcaseDb();
    this.sync(db);
  }

  public async openCachedBriefcaseDb(): Promise<BriefcaseDb | undefined> {
    const briefcases = BriefcaseManager.getCachedBriefcases(this.iModelId);
    const briefcaseEntry = briefcases[0];
    if (briefcaseEntry === undefined)
      return undefined;

    const briefcase = await BriefcaseDb.open(new ClientRequestContext(), {
      fileName: briefcases[0].fileName,
      readonly: true,
    });
    return briefcase;
  }

  public async downloadBriefcaseDb(): Promise<BriefcaseDb> {
    if (!this.authReqContext)
      throw new Error("must call signin() before downloading a BriefcaseDb.");

    // TODO call openCachedBriefcase

    const req = { contextId: this.projectId, iModelId: this.iModelId };
    const bcProps: LocalBriefcaseProps = await BriefcaseManager.downloadBriefcase(this.authReqContext, req);

    if (this.updateDbProfile || this.updateDomainSchemas)
      await BriefcaseDb.upgradeSchemas(this.authReqContext, bcProps);

    const openArgs: OpenBriefcaseProps = { fileName: bcProps.fileName };
    const db = await BriefcaseDb.open(this.authReqContext, openArgs);
    return db;
  }

  public loadConnector(): PConnector {
    const connectorModule = require(this.connectorModulePath);
    return connectorModule.getConnectorInstance();
  }

  // API EXPOSED FOR CLI

  public static async saveConnector(cmodule: string) {
    await IModelHost.startup();
    const connector = require(cmodule).getBridgeInstance();
    await connector.save();
  }

  public async saveConnector() {
    await BaseApp.saveConnector(this.connectorModulePath);
  }
}

/*
 * extend this class to create your own tests
 */
export class BaseTestApp extends BaseApp {

  public env: Environment = Environment.QA;
  public logLevel: LogLevel = LogLevel.Error;
  private _deleteBriefcasePath?: string;

  constructor(config: BaseTestAppConfig) {
    super(config as BaseAppConfig);
    this.env = Environment.QA;
    this.logLevel = LogLevel.Error;
  }

  public async downloadBriefcase() {
    if (this._deleteBriefcasePath)
      await BriefcaseManager.deleteBriefcaseFiles(this._deleteBriefcasePath, this.authReqContext);

    const briefcaseProps = await BriefcaseManager.downloadBriefcase(this.authReqContext!, { contextId: this.projectId, iModelId: this.iModelId });
    const briefcase = await BriefcaseDb.open(this.authReqContext!, {
      fileName: briefcaseProps.fileName,
      readonly: true,
    });

    this._deleteBriefcasePath = briefcaseProps.fileName;
    return briefcase;
  }

  public async createTestBriefcase(): Promise<GuidString> {
    if (!this.authReqContext)
      throw new Error("Request Context is undefined");

    const testIModelName = `Integration Test IModel (${process.platform})`;
    const iModel: HubIModel = await IModelHost.iModelClient.iModels.create(this.authReqContext, this.projectId, testIModelName, { description: `Description for ${testIModelName}` });
    const testIModelId = iModel.wsgId;
    assert(undefined !== testIModelId);
    this.iModelId = testIModelId;
    return testIModelId;
  }

  public async purgeTestBriefcase() {
    await IModelHost.iModelClient.iModels.delete(this.authReqContext!, this.projectId, this.iModelId);
  }
}
