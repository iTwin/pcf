/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { BentleyStatus, Config, GuidString, Id64String, Logger, LogLevel } from "@bentley/bentleyjs-core";
import { AuthorizedBackendRequestContext, StandaloneDb, BriefcaseDb, BriefcaseManager, IModelHost, NativeHost } from "@bentley/imodeljs-backend";
import { ElectronAuthorizationBackend } from "@bentley/electron-manager/lib/ElectronBackend";
import { LocalBriefcaseProps, NativeAppAuthorizationConfiguration, OpenBriefcaseProps } from "@bentley/imodeljs-common";
import { AccessToken, AuthorizedClientRequestContext } from "@bentley/itwin-client";
import { CodeState, HubCode, HubIModel, IModelQuery } from "@bentley/imodelhub-client";
import { BridgeRunner, BridgeJobDefArgs } from "@bentley/imodel-bridge";
import { ServerArgs } from "@bentley/imodel-bridge/lib/IModelHubUtils"
import { LogCategory } from "./LogCategory";
import { DataConnection } from "./loaders";
import * as fs from "fs";
import * as path from "path";
import * as util from "./Util";

export enum Environment {
  Prod = 0,    // Anyone
  QA   = 102,  // Bentley Developer only
  Dev  = 103,  // Bentley Developer only
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
      await connector.runJob({ db, jobArgs: this.jobArgs, authReqContext: this.authReqContext });
    } catch(err) {
      Logger.logError(LogCategory.PCF, (err as any).message);
      if (db && db.isBriefcaseDb())
        await db.concurrencyControl.abandonResources(this.authReqContext);
      runStatus = BentleyStatus.ERROR;
    } finally {
      if (db) {
        await BaseApp.clearRetiredCodes(this.authReqContext, this.hubArgs.iModelId, db.briefcaseId);
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
      client.signIn();
    });
  }

  /*
   * Open a previously downloaded BriefcaseDb on disk if present.
   */
  public async openCachedBriefcaseDb(readonlyMode: boolean = true): Promise<BriefcaseDb | undefined> {
    const cachedDbs = BriefcaseManager.getCachedBriefcases(this.hubArgs.iModelId);
    const cachedDb = cachedDbs[0];
    if (!cachedDb)
      return undefined;

    const db = await BriefcaseDb.open(this.authReqContext, {
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
      await cachedDb.pullAndMergeChanges(this.authReqContext);
      cachedDb.saveChanges();
      return cachedDb;
    }

    const req = { contextId: this.hubArgs.projectId, iModelId: this.hubArgs.iModelId };
    const bcProps: LocalBriefcaseProps = await BriefcaseManager.downloadBriefcase(this.authReqContext, req);

    if (this.hubArgs.updateDbProfile || this.hubArgs.updateDomainSchemas)
      await BriefcaseDb.upgradeSchemas(this.authReqContext, bcProps);

    const openArgs: OpenBriefcaseProps = { fileName: bcProps.fileName };
    const db = await BriefcaseDb.open(this.authReqContext, openArgs);
    return db;
  }

  /*
   * Change Codes of state "Retired" to "Available" so that they can be reused.
   */
  public static async clearRetiredCodes(authReqContext: AuthorizedBackendRequestContext, iModelId: Id64String, briefcaseId: number) {
    const codes = await IModelHost.iModelClient.codes.get(authReqContext, iModelId);
    const retiredCodes = codes.filter((code: HubCode) => code.state === CodeState.Retired);
    for (const code of retiredCodes) {
      code.briefcaseId = briefcaseId;
      code.state = CodeState.Available;
    }
    if (retiredCodes.length > 0)
      await IModelHost.iModelClient.codes.update(authReqContext, iModelId, retiredCodes);
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

