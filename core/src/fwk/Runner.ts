import { ChangesType } from "@bentley/imodelhub-client";

export async function runConnector() {}

export interface IBuilder {
  db: IModelDb;

  onChangeChannel(newParentId: Id64String): void;
  enterChannel(channelRootId: Id64String, lockRoot?: boolean): void;

  init(): Promise<void>;
  acquireDb(): Promise<void>;
  updateData(): Promise<void>;
  updateSchemas(): Promise<void>;
  updateDefinitions(): Promise<void>;
  finalizeChanges(): Promise<void>;
}

export interface BriefcaseDbBuilderProps {
  jobSubjectName: string;
  reqContext: AuthorizedClientRequestContext;
  iModelId: Id64String;
  contextId: Id64String;
  updateDbProfile: boolean;
  updateDomainSchemas: boolean;
}

class BriefcaseDbBuilder implements IBuilder {

  private _db?: BriefcaseDb;
  private _connector: Connector;
  private _activityId: GuidString;
  private _props: BriefcaseDbBuilderProps;

  constructor(connector: ITwinConnector, props: BriefcaseDbBuilderProps) {
    this._connector = connector;
    this._activityId = Guid.createValue();
    this._props = props;
  }

  public async dispatchUpdate(ctype: ChangesType, desc: string, func: async () => Promise<any>) {
    switch(ctype) {
      case ChangesType.Schema:
      case ChangesType.GlobalProperties:
        await this.enterRepositoryChannel();
        if (!this._db.concurrencyControl.locks.hasSchemaLock);
          throw new Error("does not have schema lock");
        if (!briefcaseDb.concurrencyControl.isBulkMode);
          throw new Error("not in bulk mode");
        break;
      case ChangesType.Definition:
        await this.enterConnectorChannel();
        if (this._db.concurrencyControl.locks.hasSchemaLock);
          throw new Error("has schema lock");
        if (!briefcaseDb.concurrencyControl.isBulkMode);
          throw new Error("not in bulk mode");
        break;

      case ChangesType.Regular:
      case ChangesType.SheetsAndDrawings:
      case ChangesType.SpatialData:
      case ChangesType.ViewsAndModels:
        if (this._db.concurrencyControl.locks.hasSchemaLock)
          throw new Error("has schema lock");
        if (!this._db.concurrencyControl.isBulkMode)
          throw new Error("not in bulk mode");
        await this.enterConnectorChannel();
        if (!this._db.concurrencyControl.channel.isChannelRootLocked)
          throw new Error("channel root not locked");
        break;
    }
    await func();

    await this._db.concurrencyControl.request(reqContext);
    await this._db.pullAndMergeChanges(reqContext);
    this._db.saveChanges();

    const comment = this.createComment(desc);
    await this._db.pushChanges(reqContext, comment, ctype);
  }

  public async init() {
    const { reqContext, contextId } = this._props;
    UsageLoggingUtilities.postUserUsage(reqContext, contextId, IModelJsNative.AuthType.OIDC, os.hostname(), IModelJsNative.UsageType.Trial).catch((err) => {
      Logger.logError(ConnectorLoggerCategory.Framework, `Could not log user usage for connector`, () => ({ errorStatus: err.status, errorMessage: err.message }));
    });
  }

  public async acquireDb(): Promise<void> {
    const { contextId, iModelId, reqContext, updateDbProfile, updateDomainSchemas } = this._props;
    const briefcaseId = this._connectorArgs.argsJson ? this._connectorArgs.argsJson.briefcaseId : undefined;
    const req = briefcaseId ? { contextId, iModelId, briefcaseId } : { contextId, iModelId };
    const bcProps: LocalBriefcaseProps = await BriefcaseManager.downloadBriefcase(reqContext, req);

    if (updateDbProfile || updateDomainSchemas)
      await BriefcaseDb.upgradeSchemas(reqContext, bcProps);

    const openArgs: OpenBriefcaseProps = { fileName: bcProps.fileName };
    this._db = await BriefcaseDb.open(reqContext, openArgs);

    const synchronizer = new Synchronizer(briefcaseDb, this._connector.supportsMultipleFilesPerChannel(), reqContext);
    this._connector.synchronizer = synchronizer;

    this._db.concurrencyControl.startBulkMode();
  }

  protected createComment(changeDesc: string): string {
    const { revisionComments } = this._props;
    const title = revisionComments.substring(0. 400);
    const comment = title.length > 0 ? `${title} - ${changeDesc}` : changeDesc;
    return comment;
  }

  protected updateJobSubject() {
    await this.enterConnectorChannel();
    const { jobSubjectName } = this._props;
    const existingSubject = findJobSubject(this._db, jobSubjectName);

    if (existingSubject)
      this._connector.jobSubject = existingSubject;
    else
      const newSubj = this.insertJobSubject();
  }

  protected importDefinitions() {
    await this.enterConnectorChannel();
    const { jobSubjectName } = this._props;
    const existingSubj = findJobSubject(this._db, jobSubjectName);

    if (existingSubj) {
      this._connector.jobSubject = existingSubj;
    } else {
      const newSubj = this.insertJobSubject();
      await this.saveAndPushChanges("Inserted Connector Job Subject", ChangesType.GlobalProperties);

      await this.enterConnectorChannel();
      this._connector.jobSubject = newSubj;
      await this._connector.initializeJob();
      await this.saveAndPushChanges("Initialized Connector Job Subject", ChangesType.Regular);
      await this.enterRepositoryChannel();
    }

    await this._connector.importDefinitions();
    await this.saveAndPushChanges("Definition changes", ChangesType.Definition);
  }

  protected updateSchemas() {
    const { reqContext } = this._props;

    if (this._db.concurrencyControl.locks.hasSchemaLock)
      throw new Error("has schema lock");
    if (!this._db.concurrencyControl.isBulkMode)
      throw new Error("not in bulk mode");

    await this.saveAndPushChanges("Initialization", ChangesType.Definition);

    await this.enterRepositoryChannel();
    await this._connector.importDomainSchema(reqContext);
    await this.saveAndPushChanges("Schema changes", ChangesType.Schema);

    await this.enterRepositoryChannel();
    await this._connector.importDynamicSchema(reqContext);
    await this._db.concurrencyControl.request(reqContext);
    return this.saveAndPushChanges("Dynamic schema changes", ChangesType.Schema);
  }

  protected updateExistingData() {
    const { reqContext } = this._props;

    if (this._db.concurrencyControl.locks.hasSchemaLock)
      throw new Error("has schema lock");
    if (!this._db.concurrencyControl.isBulkMode)
      throw new Error("not in bulk mode");

    await this.enterConnectorChannel();
    if (!this._imodel.concurrencyControl.channel.isChannelRootLocked)
      throw new Error("channel root not locked");

    await this._connector.updateExistingData();

    let changesDesc = "Data changes";
    if (this._connector.getDataChangesDescription)
      changesDesc = this._connector.getDataChangesDescription();

    await this.saveAndPushChanges(changesDesc, ChangesType.Regular);
  }

  public async enterRepositoryChannel() {
    const lockRoot = true;
    this.enterChannel(IModelDb.repositoryModelId, lockRoot);
  }

  public async enterConnectorChannel() {
    if (!this._jobSubject)
      throw new Error("job subject undefined");
    return this._enterChannel(this._jobSubject.id, lockRoot);
  }

  protected onChangeChannel(newParentId: Id64String) {
    if (this._db.concurrencyControl.hasPendingRequests)
      throw new Error("has pending requests");
    if (!this._db.concurrencyControl.isBulkMode)
      throw new Error("not in bulk mode");
    if (this._db.concurrencyControl.locks.hasSchemaLock)
      throw new Error("has schema lock");
    if (this._db.concurrencyControl.locks.hasCodeSpecsLock)
      throw new Error("has code spec lock");

    const root = this._db.concurrencyControl.channel.channelRoot;
    if (root) {
      const lockOnRoot = ConcurrencyControl.Request.getElementLock(root, LockScope.Exclusive);
      const holdsRootLock = this._db.concurrencyControl.locks.holdsLock(lockOnRoot);
      if (holdsRootLock)
        throw new Error("holds lock on channel root");
    }
  }

  protected enterChannel(channelRootId: Id64String, lockRoot: boolean = true) {
    const { reqContext } = this._props;
    this._db.concurrencyControl.channel.channelRoot = channelRootId;
    if (lockRoot)
      this._db.concurrencyControl.channel.lockChannelRoot(reqContext);
  }
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

