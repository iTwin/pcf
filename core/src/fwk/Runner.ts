import { ChangesType } from "@bentley/imodelhub-client";

export interface IDbController {
  commit(desc: string, ctype: ChangesType): Promise<void>;
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
}

export async function runConnector(db: IModelDb, args: any) {

  let controller;
  if (db instanceof BriefcaseDb)
    controller = new BriefcaseDbController();
  else if (db instanceof SnapshotDb)
    controller = new SnapshotDbController();
  else if (db instanceof StandaloneDb)
    controller = new StandaloneDbController();
  else
    throw new Error("db must be one of them - BriefcaseDb, SnapshotDb, or StandaloneDb");

  const db = await controller.acquire();
  const connector = loadConnector();

  // TODO Refactor Synchronizer 
  const synchronizer = new Synchronizer(db, connector.supportsMultipleFilesPerChannel(), reqContext);
  connector.synchronizer = synchronizer;

  const { jobSubjectName } = args;
  let jobSub = findJobSubject(db, jobSubjectName);
  const isBriefcaseDb = db instanceof BriefcaseDb;

  if (isBriefcaseDb)
    db.concurrencyControl.startBulkMode();

  if (!jobSub) {
    if (isBriefcaseDb)
      await this.enterSharedChannel();
    
    jobSub = insertJobSubject(db, connector, args.sourcePath);
    await controller.persistChanges("Inserted Connector Job Subject", ChangesType.GlobalProperties);

    if (isBriefcaseDb)
      await this.enterNormalChannel();

    await connector.initializeJob();
    await controller.persistChanges("Initialized Connector Job", ChangesType.Regular);
  }

  connector.jobSubject = jobSub;

  if (isBriefcaseDb)
    await this.enterNormalChannel();

  await connector.importDefinitions(reqContext);
  await controller.persistChanges("Definition Changes", ChangesType.Definition);

  if (isBriefcaseDb)
    await this.enterSharedChannel();

  await connector.importDomainSchema(reqContext);
  await controller.persistChanges("Domain Schema Changes", ChangesType.Schema);

  if (isBriefcaseDb)
    await this.enterSharedChannel();

  await connector.importDynamicSchema(reqContext);
  await controller.persistChanges("Dynamic Schema Changes", ChangesType.Schema);

  if (isBriefcaseDb)
    await this.enterNormalChannel();

  await connector.updateExistingData();
  await controller.persistChanges(this._connector.getDataChangesDescription() ?? "Data Changes", ChangesType.Regular);

  if (isBriefcaseDb)
    await this.enterNormalChannel();

  if (args.doDetectDeletedElements) {
    synchronizer.detectDeletedElements();
    updateProjectExtents(db);
    await controller.persistChanges("Finalization Changes", ChangesType.Regular);
  }
}

export class BriefcaseDbControllerProps implements IDbController {

  private _db?: BriefcaseDb;
  private _activityId: GuidString;
  private _props: BriefcaseDbControllerProps;

  constructor(db: BriefcaseDb, props: BriefcaseDbControllerProps) {
    this._db = db;
    this._activityId = Guid.createValue();
    this._props = props;
  }

  public async commit(desc: string, ctype: ChangesType) {
    await this._db.concurrencyControl.request(reqContext);
    await this._db.pullAndMergeChanges(reqContext);

    const { revisionComments } = this._props;
    const comment = this.createComment(revisionComments, desc);
    this._db.saveChanges(comment);
    await this._db.pushChanges(reqContext, comment, ctype);
  }

  public async acquire(): BriefcaseDb {
    const { contextId, iModelId, reqContext, updateDbProfile, updateDomainSchemas } = this._props;
    UsageLoggingUtilities.postUserUsage(reqContext, contextId, IModelJsNative.AuthType.OIDC, os.hostname(), IModelJsNative.UsageType.Trial).catch((err) => {
      Logger.logError(ConnectorLoggerCategory.Framework, `Could not log user usage for connector`, () => ({ errorStatus: err.status, errorMessage: err.message }));
    });

    const briefcaseId = this._connectorArgs.argsJson ? this._connectorArgs.argsJson.briefcaseId : undefined;
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

async function commit(db: IModelDb, reqContext: AuthorizedClientRequestContext, comment: string, ctype: ChangesType) {
  if (db instanceof BriefcaseDb) {
    await db.concurrencyControl.request(reqContext);
    await db.pullAndMergeChanges(reqContext);
    db.saveChanges(comment);
    await db.pushChanges(reqContext, comment, ctype);
  } else if (db instanceof SnapshotDb || db instanceof StandalongDb) {
    db.saveChanges(comment);
  }
}

async function enterSharedChannel(db: BriefcaseDb, reqContext: AuthorizedClientRequestContext) {
  await enterChannel(db, IModelDb.repositoryModelId, reqContext);
  if (!db.concurrencyControl.locks.hasSchemaLock);
    throw new Error("does not have schema lock");
}

async function enterNormalChannel(db: BriefcaseDb, subId: Id64String, reqContext: AuthorizedClientRequestContext) {
  await enterChannel(db, subId, reqContext);
  if (db.concurrencyControl.locks.hasSchemaLock);
    throw new Error("has schema lock");
}

async function enterChannel(db: BriefcaseDb, rootId: Id64String, reqContext: AuthorizedClientRequestContext) {
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

