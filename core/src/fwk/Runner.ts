import { ChangesType } from "@bentley/imodelhub-client";
import { BackendRequestContext, BriefcaseDb, BriefcaseManager, ComputeProjectExtentsOptions, ConcurrencyControl, IModelDb, IModelJsFs, IModelJsNative, LockScope, SnapshotDb, Subject, SubjectOwnsSubjects, UsageLoggingUtilities } from "@bentley/imodeljs-backend";
import { IModel, IModelError, LocalBriefcaseProps, OpenBriefcaseProps, SubjectProps } from "@bentley/imodeljs-common";
import { AccessToken, AuthorizedClientRequestContext } from "@bentley/itwin-client";
import { BridgeLoggerCategory } from "./ConnectorLoggerCategory";
import { IModelBankArgs, IModelBankUtils } from "./IModelBankUtils";
import { IModelBridge } from "./ITwinConnector";
import { ServerArgs } from "./IModelHubUtils";
import { Synchronizer } from "./Synchronizer";

/** Arguments that define how a bridge job should be run
 *  @beta
 */
export class BridgeJobDefArgs {
  /** Comment to be used as the initial string for all changesets.  Can be null. */
  public revisionComments?: string;
  /** Should be run after all documents have been synchronized.  Runs any actions (like project extent calculations) that need to run on the completed imodel */
  public allDocsProcessed: boolean = false;
  /** Indicates whether the BridgeRunner should update the profile of the imodel's db. This would only need to be set to false if the imodel needs to be opened by legacy products */
  public updateDbProfile: boolean = true;
  /** Indicates whether the BridgeRunner should update any of the core domain schemas in the imodel */
  public updateDomainSchemas: boolean = true;
  /** The module containing the IModel Bridge implementation */
  public bridgeModule?: string;
  /** Path to the source file */
  public sourcePath?: string;
  /** Path to the output directory - Only necessary when creating a snapshot */
  public outputDir?: string;
  public documentGuid?: string;
  /** The urn to fetch the input file. This and associated workspace will be downloaded */
  public dmsServerUrl?: string;
  /** OIDC or SAML access token used to login to DMS system. If omitted or empty, user credentials are used for login. */
  public dmsAccessToken?: string;
  /** Additional arguments in JSON format. */
  public argsJson: any;
  /** Synchronizes a snapshot imodel, outside of iModelHub */
  public isSnapshot: boolean = false;
  /** The synchronizer will automatically delete any element that wasn't visited. Some bridges do not visit each element on every run. Set this to false to disable automatic deletion */
  public doDetectDeletedElements: boolean = true;
}

export interface IDbController {
  commit(desc: string, ctype: ChangesType): Promise<void>;
  acquire(): Promise<IModelDb>;
}

export interface DbControllerProps {
  connectorModulePath: string;
  sourcePath: boolean;
  jobSubjectName: string;
  updateDbProfile?: boolean;
  updateDomainSchemas?: boolean;
}

export interface SnapshotDbControllerProps extends DbControllerProps {
  db: SnapshotDb;
}

export interface StandaloneDbControllerProps extends DbControllerProps {
  db: StandaloneDb;
}

export interface BriefcaseDbControllerProps extends DbControllerProps {
  db: BriefcaseDb;
  reqContext: AuthorizedClientRequestContext;
  iModelId: Id64String;
  contextId: Id64String;
  briefcaseId: number;
}

export async function runConnector(db: IModelDb) {
  let reqContext: AuthorizedClientRequestContext;
  try {

    let controller;
    if (db instanceof BriefcaseDb) {

      controller = new BriefcaseDbController();
    } else if (db instanceof SnapshotDb) {

      controller = new SnapshotDbController();
    } else if (db instanceof StandaloneDb) {

      controller = new StandaloneDbController();
    } else {
      throw new Error("db must be one of them - BriefcaseDb, SnapshotDb, or StandaloneDb");
    }

    const connector = loadConnector();

    // TODO Refactor Synchronizer 
    const synchronizer = new Synchronizer(db, connector.supportsMultipleFilesPerChannel(), reqContext);
    connector.synchronizer = synchronizer;

    const { jobSubjectName } = args;
    let jobSub = findJobSubject(db, jobSubjectName);

    if (db instanceof BriefcaseDb)
      db.concurrencyControl.startBulkMode();

    if (!jobSub) {
      await enterSharedChannel(db, reqContext);
      jobSub = insertJobSubject(db, connector, args.sourcePath);
      await controller.commit("Inserted Connector Job Subject", ChangesType.GlobalProperties);

      await enterChannel(db. reqContext, jobSub.id);
      await connector.initializeJob();
      await controller.commit("Initialized Connector Job", ChangesType.Regular);
    }

    connector.jobSubject = jobSub;

    await enterChannel(db. reqContext, jobSub.id);
    await connector.importDefinitions(reqContext);
    await controller.commit("Definition Changes", ChangesType.Definition);

    await enterSharedChannel(db, reqContext);
    await connector.importDomainSchema(reqContext);
    await controller.commit("Domain Schema Changes", ChangesType.Schema);

    await enterSharedChannel(db. reqContext);
    await connector.importDynamicSchema(reqContext);
    await controller.commit("Dynamic Schema Changes", ChangesType.Schema);

    await enterChannel(db. reqContext, jobSub.id);
    await connector.updateExistingData();
    await controller.commit(this._connector.getDataChangesDescription() ?? "Data Changes", ChangesType.Regular);

    await enterChannel(db. reqContext, jobSub.id);
    if (args.doDetectDeletedElements) {
      synchronizer.detectDeletedElements();
      updateProjectExtents(db);
      await controller.commit("Finalization Changes", ChangesType.Regular);
    }
  } catch (err) {
    await db.concurrencyControl.abandonResources(this._requestContext!);
  }
}

export class BriefcaseDbController implements IDbController {

  private _db?: BriefcaseDb;
  private _activityId: GuidString;
  private _props: BriefcaseDbControllerProps;

  constructor(db: BriefcaseDb, props: BriefcaseDbControllerProps) {
    this._db = db;
    this._activityId = Guid.createValue();
    this._props = props;
  }

  public async commit(desc: string, ctype: ChangesType) {
    const { reqContext, revisionComments } = this._props;
    await this._db.concurrencyControl.request(reqContext);
    await this._db.pullAndMergeChanges(reqContext);
    const comment = createComment(revisionComments, desc);
    this._db.saveChanges(comment);
    await this._db.pushChanges(reqContext, comment, ctype);
  }

  public async acquire(): BriefcaseDb {
    const { contextId, iModelId, reqContext, updateDbProfile, updateDomainSchemas, briefcaseId } = this._props;

    const req = briefcaseId ? { contextId, iModelId, briefcaseId } : { contextId, iModelId };
    const bcProps: LocalBriefcaseProps = await BriefcaseManager.downloadBriefcase(reqContext, req);

    if (updateDbProfile || updateDomainSchemas)
      await BriefcaseDb.upgradeSchemas(reqContext, bcProps);

    const openArgs: OpenBriefcaseProps = { fileName: bcProps.fileName };
    this._db = await BriefcaseDb.open(reqContext, openArgs);
    this._db.concurrencyControl.startBulkMode();

    return this._db;
  }
}

async function enterSharedChannel(db: BriefcaseDb, reqContext: AuthorizedClientRequestContext) {
  await enterChannel(db, IModelDb.repositoryModelId, reqContext);
  if (!db.concurrencyControl.locks.hasSchemaLock);
    throw new Error("does not have schema lock");
}

async function enterChannel(db: BriefcaseDb, reqContext: AuthorizedClientRequestContext, rootId: Id64String) {
  if (db.concurrencyControl.hasPendingRequests)
    throw new Error("has pending requests");
  if (!db.concurrencyControl.isBulkMode)
    throw new Error("not in bulk mode");
  if (db.concurrencyControl.locks.hasSchemaLock)
    throw new Error("has schema lock");
  if (db.concurrencyControl.locks.hasCodeSpecsLock)
    throw new Error("has code spec lock");
  if (db.concurrencyControl.channel.isChannelRootLocked())
    throw new Error("holds lock on current channel root. it must be released before entering a new channel.");
  db.concurrencyControl.channel.channelRoot = rootId;
  await db.concurrencyControl.channel.lockChannelRoot(reqContext);
  if (!db.concurrencyControl.channel.isChannelRootLocked)
    throw new Error("channel root not locked");
}

function createComment(revisionComments: string, changeDesc: string): string {
  const title = revisionComments.substring(0. 400);
  const comment = title.length > 0 ? `${title} - ${changeDesc}` : changeDesc;
  return comment;
}

function loadConnector(connectorModulePath: string): Connector {
  const connectorModule = require(connectorModulePath);
  return connectorModule.getConnectorInstance();
}

function updateProjectExtents(db: IModelDb) {
  const options: ComputeProjectExtentsOptions = {
    reportExtentsWithOutliers: false,
    reportOutliers: false,
  };
  const res = db.computeProjectExtents(options);
  db.updateProjectExtents(res.extents);
}

function insertJobSubject(db: IModelDb, connector: Connector, subjName: string): Subject {
  const jsonProperties = {
    Subject: {
      Job: {
        Properties: {
          ConnectorVersion: connector.getApplicationVersion(),
          ConnectorType: "",
        },
        Connector: connector.getConnectorName(),
        Comments: "",
      }
    },
  }

  const root = db.elements.getRootSubject();
  const code = Subject.createCode(db, root.id, subjName);

  const subjProps: SubjectProps = {
    classFullName: Subject.classFullName,
    model: root.model,
    code,
    jsonProperties,
    parent: new SubjectOwnsSubjects(root.id),
  };

  const subjId = db.elements.insertElement(subjProps);
  const subj = db.elements.getElement<Subject>(subjId);

  return subj;
}

function findJobSubject(db: IModelDb, subjName: string): Subject | undefined {
  const code = Subject.createCode(db, IModel.rootSubjectId, subjName);
  const subjId = db.elements.queryElementIdByCode(code);
  if (subjId)
    return db.elements.tryGetElement<Subject>(subjId);
  return undefined;
}

