/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { Id64String, Logger, LogLevel } from "@itwin/core-bentley";
import { BriefcaseDb, BriefcaseManager, IModelHost, RequestNewBriefcaseArg } from "@itwin/core-backend";
import { ElectronAuthorizationBackend } from "@itwin/core-electron/lib/cjs/backend/ElectronAuthorizationBackend";
import { LocalBriefcaseProps, NativeAppAuthorizationConfiguration, OpenBriefcaseProps } from "@itwin/core-common";
import { ServiceAuthorizationClient, ServiceAuthorizationClientConfiguration } from "@itwin/service-authorization";
import { IModelHubBackend } from "@bentley/imodelhub-client/lib/cjs/IModelHubBackend";
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
   * absolute path to compiler connector module (.js)
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
  subjectNodeKey: string;

  /*
   * absolute path to the directory for storing output files like cached Briefcase.
   */
  outputDir?: string;

  /*
   * change log level to debug your connector (rarely needed)
   */
  logLevel?: LogLevel;

  /* 
   * allows elements to be deleted if they no longer exist in the source file. For a BriefcaseDb, 
   * only elements in the current subject channel can be deleted.
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
  public subjectNodeKey: string;
  public outputDir: string = path.join(__dirname, "output");
  public logLevel: LogLevel = LogLevel.None;
  public enableDelete: boolean = true;
  public revisionHeader: string = "iTwin.PCF";

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
    this.validate();
  }

  public validate() {
    if (this.connection.kind === "pcf_file_connection" && !fs.existsSync(this.connection.filepath))
      throw new Error("Could not find file with JobArgs.connection.filepath");
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
  clientConfig: NativeAppAuthorizationConfiguration | ServiceAuthorizationClientConfiguration;

  /*
   * Only Bentley developers could override this value for testing. Do not override it in production.
   */
  urlPrefix?: ReqURLPrefix;
}

export class HubArgs implements HubArgsProps {

  public projectId: Id64String;
  public iModelId: Id64String;
  public clientConfig: NativeAppAuthorizationConfiguration | ServiceAuthorizationClientConfiguration;
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

    const hubAccess = new IModelHubBackend();
    IModelHost.setHubAccess(hubAccess);

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
    let db: BriefcaseDb | undefined = undefined;
    let success = false;

    try {
      await IModelHost.startup();
      await this.signin();
      db = await this.openBriefcaseDb();
      const connector: PConnector = await require(jobArgs.connectorPath).getConnectorInstance();
      await connector.runJobUnsafe(db, jobArgs);
      success = true;
    } catch(err) {
      Logger.logError(LogCategory.PCF, (err as any).message);
      Logger.logTrace(LogCategory.PCF, err as any);
      success = false
    } finally {
      if (db) {
        db.abandonChanges();
        db.close();
      }
      await IModelHost.shutdown();
    }

    return success;
  }

  /*
   * Interactively sign in through your Bentley account. This call opens up a page in your browser and prompts you to sign in.
   */
  public async signin(): Promise<AccessToken> {
    if (this._token)
      return this._token;

    const config = this.hubArgs.clientConfig as NativeAppAuthorizationConfiguration;
    if (!config.issuerUrl)
      config.issuerUrl = `https://${this.hubArgs.urlPrefix}ims.bentley.com`;

    const client = new ElectronAuthorizationBackend(config);
    await client.initialize(config);
    IModelHost.authorizationClient = client;
    const token = await client.signInComplete();
    this._token = token;
    return token;
  }

  /*
   * Non-interactively sign in
   */
  public async signinSilent(): Promise<AccessToken> {
    if (this._token)
      return this._token;

    const config = this.hubArgs.clientConfig as ServiceAuthorizationClientConfiguration;
    if (!config.authority)
      (config as any).authority = `https://${this.hubArgs.urlPrefix}ims.bentley.com`;

    const client = new ServiceAuthorizationClient(config);
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

    const fileName = bcPropsList[0].fileName;
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
  public async openBriefcaseDb(): Promise<BriefcaseDb> {
    const cachedDb = await this.openCachedBriefcaseDb(false);
    if (cachedDb)
      return cachedDb;

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

