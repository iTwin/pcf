/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { Id64String, Logger, LogLevel, BentleyError, IModelHubStatus } from "@itwin/core-bentley";
import { BriefcaseDb, BriefcaseManager, IModelHost, RequestNewBriefcaseArg, BackendHubAccess } from "@itwin/core-backend";
import {ElectronMainAuthorization} from "@itwin/electron-authorization/lib/cjs/ElectronMain";
import { LocalBriefcaseProps, OpenBriefcaseProps} from "@itwin/core-common";
import { ServiceAuthorizationClient, ServiceAuthorizationClientConfiguration } from "@itwin/service-authorization";
import {NodeCliAuthorizationClient, NodeCliAuthorizationConfiguration} from "@itwin/node-cli-authorization";
import { IModelsClient } from "@itwin/imodels-client-authoring";
import { BackendIModelsAccess } from "@itwin/imodels-access-backend";
import { AccessToken } from "@itwin/core-bentley";
import { PConnector, DataConnection, LogCategory } from "./pcf";
import * as fs from "fs";
import * as path from "path";

export enum ReqURLPrefix {
  Prod = "",
  QA   = "qa-",
  Dev  = "dev-",
}

export interface JobArgsProps {

  /* 
   * Absolute path to compiler connector module (.js)
   */
  connectorPath: string; 

  /* 
   * Info needed to connect to source data
   */
  connection: DataConnection;

  /*
   * subjectNodeKey references an existing subject node defined in your connector and uniquely identifies 
   * a subject element in an iModel. pcf will synchronize all the data stored under this subject 
   * with source file.
   */
  subjectNodeKey: string;

  /*
   * Absolute path to the directory for storing output files like cached Briefcase.
   */
  outputDir?: string;

  /*
   * Change log level to debug your connector (rarely needed)
   */
  logLevel?: LogLevel;

  /* 
   * Allows elements to be deleted if they no longer exist in the source file. 
   * For a BriefcaseDb, only elements in the current subject channel can be deleted.
   */
  enableDelete?: boolean;

  /*
   * Header of save/push comments. Push Comment = "<revisionHeader> - <your comment>".
   */
  revisionHeader?: string;

   /*
   * if false or undefined IModelHost.startup() will be called by runConnectorJob.
   * in the case of scheduled repeated multiple runs or orchestration, may want to set this to true
   * startup host beforehand, then run
   */
    suppressHostStartupOnRun?: boolean;

   /*
   * if false or undefined BaseApp.signin() will be called by runConnectorJob .
   * in the case of scheduled repeated multiple runs or orchestration, may want to set this to true
   * signin and get token once beforehand, then run
   */
   suppressSigninOnRun?: boolean;
}

export class JobArgs implements JobArgsProps {

  public connectorPath: string;
  public connection: DataConnection;
  public subjectNodeKey: string;
  public outputDir: string = path.join(__dirname, "output");
  public logLevel: LogLevel = LogLevel.None;
  public enableDelete: boolean = true;
  public revisionHeader: string = "iTwin.PCF";
  public suppressHostStartupOnRun: boolean = false;
  public suppressSigninOnRun: boolean = false;

  constructor(props: JobArgsProps) {
    this.connectorPath = props.connectorPath;
    this.connection = props.connection;
    this.subjectNodeKey = props.subjectNodeKey;

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
    if (props.suppressHostStartupOnRun !== undefined)
      this.suppressHostStartupOnRun = props.suppressHostStartupOnRun;
    if (props.suppressSigninOnRun !== undefined)
      this.suppressSigninOnRun = props.suppressSigninOnRun;

    this.validate();
  }

  public validate() {
    if (this.connection.kind === "pcf_file_connection" && !fs.existsSync(this.connection.filepath))
      throw new Error("Could not find file with JobArgs.connection.filepath");
  }
}

export interface HubArgsProps {

  /*
   * Your project GUID (it's also called "contextId")
   */
  projectId: Id64String;

  /*
   * Your iModel GUID
   */
  iModelId: Id64String;

  /*
   * You may acquire client configurations from https://developer.bentley.com by creating a SPA app
   */

  clientConfig: NodeCliAuthorizationConfiguration|ServiceAuthorizationClientConfiguration;

  /*
   * Only Bentley developers could override this value for testing. Do not override it in production.
   */
  urlPrefix?: ReqURLPrefix;
}

export class HubArgs implements HubArgsProps {

  public projectId: Id64String;
  public iModelId: Id64String;
  public clientConfig: NodeCliAuthorizationConfiguration|ServiceAuthorizationClientConfiguration;
  public urlPrefix: ReqURLPrefix = ReqURLPrefix.Prod;
  public updateDbProfile: boolean = false;
  public updateDomainSchemas: boolean = false;

  constructor(props: HubArgsProps) {
    this.projectId = props.projectId;
    this.iModelId = props.iModelId;
    this.clientConfig = props.clientConfig;
    if (props.urlPrefix !== undefined)
      this.urlPrefix = props.urlPrefix;
    this.validate();
  }

  public validate() {}
}

/*
 * The driver for your entire connector program.
 * BaseApp takes care of all the prerequisites to run your connector.
 */
export class BaseApp {

  public hubArgs: HubArgs;
  public briefcaseDb?: BriefcaseDb;
  protected _token?: AccessToken;

  public get token() {
    if (!this._token)
      throw new Error("Not signed in. Invoke either BaseApp.signin() or BaseApp.signinSilent().");
    return this._token;
  }

  constructor(hubArgs: HubArgs, logLevel: LogLevel = LogLevel.Info) {
    this.hubArgs = hubArgs;

    const envStr = String(this.hubArgs.urlPrefix);
    process.env["IMJS_URL_PREFIX"] = envStr;
    const iModelClient = new IModelsClient({ api: { baseUrl: `https://${process.env.IMJS_URL_PREFIX ?? ""}api.bentley.com/imodels`}});
    IModelHost.setHubAccess(new BackendIModelsAccess(iModelClient));

    this.initLogging(logLevel);
  }

  public initLogging(defaultLevel: LogLevel) {
    Logger.initializeToConsole();
    Logger.configureLevels({
      categoryLevels: [
        {
          category: LogCategory.PCF,
          logLevel: LogLevel[defaultLevel],
        },
      ]
    });
  }

  /*
   * Safely executes a connector job to synchronize a BriefcaseDb.
   */
  public async runConnectorJob(jobArgs: JobArgs): Promise<boolean> {
    let success = false;
    try {
      if (!jobArgs.suppressHostStartupOnRun)
        await IModelHost.startup();

      if (!jobArgs.suppressSigninOnRun)
        await this.signin();

      this.briefcaseDb = await this.openBriefcaseDb();

      const connector: PConnector = await require(jobArgs.connectorPath).getConnectorInstance();
      await connector.runJobUnsafe(this.briefcaseDb, jobArgs);
      success = true;
    } catch(err) {
      Logger.logError(LogCategory.PCF, (err as any).message);
      Logger.logTrace(LogCategory.PCF, (err as any).stack);
      await this.handleError(err);
      success = false
    } finally {
      if (this.briefcaseDb) {
        this.briefcaseDb.abandonChanges();
        // if (this.briefcaseDb.isBriefcaseDb())
        //   await this.briefcaseDb.locks.releaseAllLocks();
        this.briefcaseDb.close();
      }

      // only shut down IModelHost if we started!!!
      if (!jobArgs.suppressHostStartupOnRun)
        await IModelHost.shutdown();
    }

    return success;
  }

  /*
   * Handle errors/exceptions occurred to potentially prevent the same error in the next run
   */
  public async handleError(err: any) {
    if (!(err instanceof BentleyError))
      return;
    if (this.briefcaseDb && err.errorNumber === IModelHubStatus.BriefcaseDoesNotBelongToUser) {
      const ignoreCache = true;
      const db = await this.openBriefcaseDb(ignoreCache);
      db.close();
      const errorStr = IModelHubStatus[IModelHubStatus.BriefcaseDoesNotBelongToUser];
      Logger.logInfo(LogCategory.PCF, `Handled ${errorStr} error and downloaded a new iModel with a new BriefcaseId for current user. Try running again.`);
    }
  }

  /*
   * Sign in based on client config
   */
  public async signin(): Promise<AccessToken> {
    let token: AccessToken;
    const hasClientSecret = (this.hubArgs.clientConfig as ServiceAuthorizationClientConfiguration).clientSecret;
    if (hasClientSecret)
      token = await this.nonInteractiveSignin();
    else
      token = await this.interactiveSignin();

    return token;
  }

  /*
   * Interactively sign in through your Bentley account. This call opens up a page in your browser and prompts you to sign in.
   */

  public async interactiveSignin(): Promise<AccessToken> {
    if (this._token)
      return this._token;


    const authClient = new NodeCliAuthorizationClient(this.hubArgs.clientConfig);
    await authClient.signIn();
    const token = await authClient.getAccessToken();
    IModelHost.authorizationClient = authClient;

    if (!token)
      throw new Error("Failed to get test access token");
    this._token = token;
    return this._token; 
  }

  /*
   * Non-interactively sign in through a client secret.
   */
  public async nonInteractiveSignin(): Promise<AccessToken> {
    if (this._token)
      return this._token;

    const client = new ServiceAuthorizationClient(this.hubArgs.clientConfig as ServiceAuthorizationClientConfiguration);
    const token = await client.getAccessToken();
    IModelHost.authorizationClient = client;
    this._token = token;
    return token;
  }

  /*
   * Open a previously downloaded BriefcaseDb on disk if present.
   */
  public async openCachedBriefcaseDb(readonlyMode: boolean = true): Promise<BriefcaseDb | undefined> {
    const bcPropsList: LocalBriefcaseProps[] = BriefcaseManager.getCachedBriefcases(this.hubArgs.iModelId);
    if (bcPropsList.length == 0)
      return undefined;

    const last = bcPropsList.length - 1;
    const fileName = bcPropsList[last].fileName;
    const cachedDb = await BriefcaseDb.open({
      fileName: fileName,
      readonly: readonlyMode,
    });

    await cachedDb.pullChanges();
    cachedDb.saveChanges();
    return cachedDb;
  }

  /*
   * Downloads and opens a most-recent BriefcaseDb from iModel Hub if not in cache.
   */
  public async openBriefcaseDb(ignoreCache: boolean = false): Promise<BriefcaseDb> {
    if (!ignoreCache) {
      const cachedDb = await this.openCachedBriefcaseDb(false);
      if (cachedDb)
        return cachedDb;
    }

    const arg: RequestNewBriefcaseArg = { accessToken: this.token, iTwinId: this.hubArgs.projectId, iModelId: this.hubArgs.iModelId };
    const bcProps: LocalBriefcaseProps = await BriefcaseManager.downloadBriefcase(arg);

    if (this.hubArgs.updateDbProfile || this.hubArgs.updateDomainSchemas)
      await BriefcaseDb.upgradeSchemas(bcProps);

    const openArgs: OpenBriefcaseProps = { fileName: bcProps.fileName };
    const db = await BriefcaseDb.open(openArgs);
    return db;
  }

  /*
   * Executes connector-framework in BaseApp
   */
  /*
  public async runConnectorJob(): Promise<BentleyStatus> {
    await IModelHost.startup();
    const authReqContext = await this.signin();

    const jobDefArgs = new BridgeJobDefArgs();
    jobDefArgs.doDetectDeletedElements = false;
    jobDefArgs.bridgeModule = this.jobArgs.connectorPath;
    jobDefArgs.sourcePath = this.jobArgs.connection.filepath;
    jobDefArgs.updateDbProfile = false;
    jobDefArgs.updateDomainSchemas = false;
    jobDefArgs.revisionComments = this.jobArgs.revisionHeader;
    jobDefArgs.argsJson = { jobArgs: this.jobArgs };

    const serverArgs = new ServerArgs();
    serverArgs.contextId = this.hubArgs.projectId;
    serverArgs.iModelId = this.hubArgs.iModelId;
    serverArgs.getToken = async () => authReqContext.accessToken;

    const runner = new BridgeRunner(jobDefArgs, serverArgs);
    const status = await runner.synchronize();

    if (status === BentleyStatus.SUCCESS) {
      const cachedDb = await this.openCachedBriefcaseDb();
      if (!cachedDb)
        throw new Error("No BriefcaseDb cached after a successful run of runner.synchronize().");
      const briefcaseId = cachedDb.briefcaseId;
      cachedDb.close();
      await BaseApp.clearRetiredCodes(authReqContext, serverArgs.iModelId, briefcaseId);
    }

    await IModelHost.shutdown();
    return status;
  }
  */
}

