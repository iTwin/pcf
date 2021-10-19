/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { BentleyStatus, Id64String, Logger, LogLevel } from "@itwin/core-bentley";
import { StandaloneDb, BriefcaseDb, BriefcaseManager, IModelHost, NativeHost, RequestNewBriefcaseArg } from "@itwin/core-backend";
import { ElectronAuthorizationBackend } from "@itwin/electron-manager/lib/ElectronBackend";
import { IModel, LocalBriefcaseProps, NativeAppAuthorizationConfiguration, OpenBriefcaseProps } from "@itwin/core-common";
import { AccessToken } from "@itwin/core-bentley";
import { LogCategory } from "./LogCategory";
import { DataConnection } from "./loaders";
import * as fs from "fs";
import * as path from "path";
import * as util from "./Util";

export enum URLPrefix {
  Prod = "",     // Anyone
  QA   = "qa-",  // Bentley Developer only
  Dev  = "dev-", // Bentley Developer only
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
  public subjectKey: string;
  public outputDir: string = path.join(__dirname, "output");
  public logLevel: LogLevel = LogLevel.None;
  public enableDelete: boolean = true;
  public revisionHeader: string = "iTwin.PCF";

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
  clientConfig: NativeAppAuthorizationConfiguration;

  /*
   * Only Bentley developers could override this value for testing. Do not override it in production.
   */
  urlPrefix?: URLPrefix;
}

export class HubArgs implements HubArgsProps {
  public projectId: Id64String;
  public iModelId: Id64String;
  public clientConfig: NativeAppAuthorizationConfiguration;
  public urlPrefix: URLPrefix = URLPrefix.Prod;
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

  public jobArgs: JobArgs;
  public hubArgs: HubArgs;
  protected _token?: AccessToken;

  public get token() {
    if (!this._token)
      throw new Error("not signed in");
    return this._token;
  }

  constructor(jobArgs: JobArgs, hubArgs: HubArgs) {
    this.hubArgs = hubArgs;
    this.jobArgs = jobArgs;

    const envStr = String(this.hubArgs.urlPrefix);
    process.env["IMJS_URL_PREFIX"] = envStr;

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
    let db: BriefcaseDb | undefined = undefined;
    let runStatus = BentleyStatus.SUCCESS;
    try {
      await IModelHost.startup();
      await this.signin();
      db = await this.openBriefcaseDb();
      const connector = await require(this.jobArgs.connectorPath).getBridgeInstance();
      await connector.runJob({ db, jobArgs: this.jobArgs, authReqContext: this.token });
    } catch(err) {
      Logger.logError(LogCategory.PCF, (err as any).message);
      runStatus = BentleyStatus.ERROR;
    } finally {
      if (db) {
        db.abandonChanges();
        db.close();
      }
      await IModelHost.shutdown();
    }
    return runStatus;
  }

  /*
   * Executes connector-framework in BaseApp
   */
  /*
  public async runFwk(): Promise<BentleyStatus> {
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

  /*
   * Sign in through your iModelHub account. This call opens up a page in your browser and prompts you to sign in.
   */
  public async signin(): Promise<AccessToken> {
    if (this._token)
      return this._token;
    const token = await this.getToken();
    this._token = token;
    return token;
  }

  public async getToken(): Promise<AccessToken> {
    const client = new ElectronAuthorizationBackend();
    await client.initialize(this.hubArgs.clientConfig);
    return client.signInComplete();
  }

  /*
   * Open a previously downloaded BriefcaseDb on disk if present.
   */
  public async openCachedBriefcaseDb(readonlyMode: boolean = true): Promise<BriefcaseDb | undefined> {
    const cachedDbs = BriefcaseManager.getCachedBriefcases(this.hubArgs.iModelId);
    const cachedDb = cachedDbs[0];
    if (!cachedDb)
      return undefined;

    const db = await BriefcaseDb.open({
      fileName: cachedDb.fileName,
      readonly: readonlyMode,
    });
    return db;
  }

  /*
   * Downloads and opens a most-recent BriefcaseDb from iModel Hub if not in cache.
   */
  public async openBriefcaseDb(): Promise<BriefcaseDb> {
    const cachedDb = await this.openCachedBriefcaseDb(false);
    if (cachedDb) {
      await cachedDb.pullChanges({ accessToken: this.token });
      cachedDb.saveChanges();
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

