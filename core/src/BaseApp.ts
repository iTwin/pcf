import { assert, BentleyStatus, ClientRequestContext, Config, GuidString, Id64String, Logger, LogLevel } from "@bentley/bentleyjs-core";
import { AuthorizedBackendRequestContext, BriefcaseDb, BriefcaseManager, IModelHost, NativeHost } from "@bentley/imodeljs-backend";
import { ElectronAuthorizationBackend } from "@bentley/electron-manager/lib/ElectronBackend";
import { NativeAppAuthorizationConfiguration } from "@bentley/imodeljs-common";
import { AccessToken } from "@bentley/itwin-client";
import { Briefcase as HubBriefcase, HubIModel } from "@bentley/imodelhub-client";
import { BridgeJobDefArgs, BridgeRunner } from "./fwk/BridgeRunner";
import { IModelBankArgs } from "./fwk/IModelBankUtils";
import { LogCategory } from "./LogCategory";

// QA and Dev are for Bentley Developer only
export enum Environment {
  Prod = 0,
  QA = 102,
  Dev = 103,
}

export interface BaseAppConfig {
  // relative path to your 'compiled' javascript (.js) connector module.
  connectorModule: string,
  // relative path to folder storing the files created after each run, if any.
  outputDir: string, 
  // relative path to your source data file
  sourcePath: string,
  // your project's GUID ID 
  projectId: Id64String | GuidString, 
  // your iModel's GUID ID 
  iModelId: Id64String | GuidString,
  // you may obtain client configurations from https://developer.bentley.com by creating a SPA app
  clientConfig: NativeAppAuthorizationConfiguration;
  // do not override this value if you're not a Bentley developer.
  env?: Environment;
  // change log level to debug your connector (rarely needed)
  logLevel?: LogLevel;
}

export interface BaseTestAppConfig {
  outputDir: string, 
  sourcePath: string,
  projectId: Id64String | GuidString, 
  clientConfig: NativeAppAuthorizationConfiguration;
  env?: Environment;
  logLevel?: LogLevel;
}

/*
 * The driver for your entire connector program.
 * BaseApp takes care of all the prerequisites to run your connector.
 */
export class BaseApp {

  public requestContext?: AuthorizedBackendRequestContext;
  public jobArgs: BridgeJobDefArgs;
  public serverArgs: IModelBankArgs;
  public env: Environment;
  public logLevel: LogLevel;
  public clientConfig: NativeAppAuthorizationConfiguration;

  constructor(config: BaseAppConfig) {
    this.env = config.env ?? Environment.Prod;
    this.logLevel = config.logLevel ?? LogLevel.None;
    this.clientConfig = config.clientConfig;

    this.jobArgs = new BridgeJobDefArgs();
    this.jobArgs.bridgeModule = config.connectorModule;
    this.jobArgs.sourcePath = config.sourcePath;
    this.jobArgs.outputDir = config.outputDir;
    this.jobArgs.revisionComments = "itwin-pcf"

    // disable upgrade schemas for now
    this.jobArgs.doDetectDeletedElements = true;
    this.jobArgs.updateDbProfile = false;
    this.jobArgs.updateDomainSchemas = false;

    this.serverArgs = new IModelBankArgs();
    this.serverArgs.contextId = config.projectId;
    this.serverArgs.iModelId = config.iModelId;
  }

  /*
   * a single call that executes your connector
   */
  public async run() {
    await this.startup();
    await this.signin();
    await this.sync();
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
    let token: AccessToken;
    if (this.serverArgs.getToken) {
      token = await this.serverArgs.getToken();
      this.requestContext = new AuthorizedBackendRequestContext(token);
    } else {
      token = await this._signIn();
      this.serverArgs.getToken = async (): Promise<AccessToken> => token;
    }
    this.requestContext = new AuthorizedBackendRequestContext(token);
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
   * Executes itwin-connector-framework
   */
  public async sync() {
    const runner = new BridgeRunner(this.jobArgs, this.serverArgs);
    const result = await runner.synchronize();
    assert(result === BentleyStatus.SUCCESS);
  }

  // API EXPOSED FOR CLI

  public static async saveConnector(cmodule: string) {
    await IModelHost.startup();
    const connector = require(cmodule).getBridgeInstance();
    await connector.save();
  }

  public async saveConnector() {
    await BaseApp.saveConnector(this.jobArgs.bridgeModule!);
  }
}

/*
 * extend this class to create your own tests
 */
export class BaseTestApp extends BaseApp {

  private _deleteBriefcasePath?: string;

  constructor(config: BaseTestAppConfig) {
    super(config as BaseAppConfig);
    this.env = config.env ?? Environment.QA;
    this.logLevel = config.logLevel ?? LogLevel.Error;
  }

  public async openCachedBriefcase() {
    const { iModelId } = this.serverArgs;
    const briefcases = BriefcaseManager.getCachedBriefcases(iModelId);
    const briefcaseEntry = briefcases[0];
    if (briefcaseEntry === undefined)
      throw new Error("Undefined Briefcase Entry.");

    const briefcase = await BriefcaseDb.open(new ClientRequestContext(), {
      fileName: briefcases[0].fileName,
      readonly: true,
    });
    return briefcase;
  }

  public async openBriefcase() {
    if (this._deleteBriefcasePath)
      await BriefcaseManager.deleteBriefcaseFiles(this._deleteBriefcasePath, this.requestContext);

    const contextId = this.serverArgs.contextId!;
    const iModelId = this.serverArgs.iModelId!;
    const briefcaseProps = await BriefcaseManager.downloadBriefcase(this.requestContext!, { contextId, iModelId });

    const briefcase = await BriefcaseDb.open(this.requestContext!, {
      fileName: briefcaseProps.fileName,
      readonly: true,
    });

    this._deleteBriefcasePath = briefcaseProps.fileName;
    return briefcase;
  }

  public async createTestIModel(): Promise<GuidString> {
    if (!this.requestContext)
      throw new Error("Request Context is undefined");

    const { contextId: testProjectId } = this.serverArgs;
    const testIModelName = `Integration Test IModel (${process.platform})`;
    const iModel: HubIModel = await IModelHost.iModelClient.iModels.create(this.requestContext, testProjectId!, testIModelName, { description: `Description for ${testIModelName}` });
    const testIModelId = iModel.wsgId;
    assert(undefined !== testIModelId);
    this.serverArgs.iModelId = testIModelId;
    return testIModelId;
  }

  public async purgeTestIModel() {
    const { contextId: testProjectId, iModelId: testIModelId } = this.serverArgs;
    await IModelHost.iModelClient.iModels.delete(this.requestContext!, testProjectId!, testIModelId!);
  }
}
