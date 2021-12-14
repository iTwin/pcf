/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { Id64String, Logger } from "@itwin/core-bentley";
import { Code, CodeScopeSpec, CodeSpec, ExternalSourceAspectProps, IModel, ElementProps, ElementAspectProps, IModelError } from "@itwin/core-common";
import { BriefcaseDb, ComputeProjectExtentsOptions, DefinitionElement, ElementAspect, ElementUniqueAspect, ExternalSourceAspect, IModelDb, PushChangesArgs, SnapshotDb, StandaloneDb } from "@itwin/core-backend";
import { LogCategory } from "./LogCategory";
import * as util from "./Util";
import * as pcf from "./pcf";
import * as path from "path";

export interface PConnectorConfigProps {

  /*
   * application ID
   */
  appId: string;

  /*
   * application version
   */
  appVersion: string;

  /*
   * the name of your connector (e.g. COBieConnector)
   */
  connectorName: string;

  /*
   * Local paths to the domain xml schemas referenced. Leave this empty if only BisCore Schema is used.
   */
  domainSchemaPaths?: string[];

  /*
   * A dynamic schema would be created if this is defined. If you already defined EC Dynamic Class Props
   * in your DMO's, this must be defined.
   */
  dynamicSchema?: {

    /*
     * The name of your Dynamic Schema if any. (e.g. 'COBieDynamic')
     */
    schemaName: string;

    /*
     * The alias of your Dynamic Schema name if any. (e.g. 'COBieDynamic' => 'cd')
     */
    schemaAlias: string;
  }
}

export class PConnectorConfig implements PConnectorConfigProps {

  public appId: string;
  public appVersion: string;
  public connectorName: string;
  public domainSchemaPaths: string[] = [];
  public dynamicSchema?: {
    schemaName: string;
    schemaAlias: string;
  }

  constructor(pc: PConnector, props: PConnectorConfigProps) {
    this.appId = props.appId;
    this.appVersion = props.appVersion;
    this.connectorName = props.connectorName;
    if (props.domainSchemaPaths !== undefined)
      this.domainSchemaPaths = props.domainSchemaPaths;
    if (props.dynamicSchema !== undefined)
      this.dynamicSchema = props.dynamicSchema;
    pc.config = this;
  }
}

export abstract class PConnector {

  public static CodeSpecName: string = "IREntityKey-PrimaryKeyValue";

  public subjectCache: { [subjectNodeKey: string]: Id64String };
  public modelCache: { [modelNodeKey: string]: Id64String };
  public elementCache: { [instanceKey: string]: Id64String };
  public aspectCache: { [instanceKey: string]: Id64String };
  public seenIdSet: Set<Id64String>;

  public readonly tree: pcf.RepoTree;

  protected _config?: PConnectorConfig;
  protected _db?: IModelDb;
  protected _jobArgs?: pcf.JobArgs;
  protected _irModel?: pcf.IRModel;
  protected _jobSubjectId?: Id64String;
  protected _srcState?: pcf.ItemState;

  /*
   * Define construct instances in this function.
   */
  public abstract form(): Promise<void>;

  constructor() {
    this.subjectCache = {};
    this.modelCache = {};
    this.elementCache = {};
    this.aspectCache = {};
    this.tree = new pcf.RepoTree();
    this.seenIdSet = new Set<Id64String>();
  }

  public get config() {
    if (!this._config)
      throw new Error("You must define PConnectorConfig in the constructor of your connector class");
    return this._config;
  } 

  public set config(config: PConnectorConfig) {
    this._config = config;
  } 

  public get db() {
    if (!this._db) 
      throw new Error("IModelDb is not assigned");
    return this._db;
  }

  public get jobArgs() {
    if (!this._jobArgs) 
      throw new Error("JobArgs is not assigned");
    return this._jobArgs;
  }

  public get jobSubjectId() {
    if (!this._jobSubjectId) 
      throw new Error("job subject ID is undefined. call updateSubject to populate its value.");
    return this._jobSubjectId;
  }

  public get irModel() {
    if (!this._irModel) 
      throw new Error("irModel has not been initialized. call loadIRModel to populate its value.");
    return this._irModel;
  }

  public get srcState() {
    if (this._srcState === undefined) 
      throw new Error("srcState is undefined. call Loader.update() to populate its value.");
    return this._srcState;
  }

  public get dynamicSchemaName() {
    if (!this.config.dynamicSchema)
      throw new Error("PConnectorConfig.dynamicSchema is not defined");
    return this.config.dynamicSchema.schemaName;
  }

  public async runJobUnsafe(db: IModelDb, jobArgs: pcf.JobArgs): Promise<void> {
    this.modelCache = {};
    this.elementCache = {};
    this.aspectCache = {};
    this.seenIdSet = new Set<Id64String>();

    this._db = db;
    Logger.logInfo(LogCategory.PCF, `Used local iModel at ${this.db.pathName}`);

    this.tree.validate(jobArgs);
    this._jobArgs = jobArgs;

    Logger.logInfo(LogCategory.PCF, "Your Connector Job has started");

    Logger.logInfo(LogCategory.PCF, "Started Domain Schema Update...");
    await this.acquireLock(IModel.repositoryModelId);
    await this._updateDomainSchema();
    await this.persistChanges(`Domain Schema Update`);
    await this.releaseAllLocks();
    Logger.logInfo(LogCategory.PCF, "Completed Domain Schema Update...");

    Logger.logInfo(LogCategory.PCF, "Started Dynamic Schema Update...");
    await this.acquireLock(IModel.repositoryModelId);
    await this._updateDynamicSchema();
    await this.persistChanges("Dynamic Schema Update");
    await this.releaseAllLocks();
    Logger.logInfo(LogCategory.PCF, "Completed Dynamic Schema Update.");

    Logger.logInfo(LogCategory.PCF, "Started Subject Update...");
    await this.acquireLock(IModel.repositoryModelId);
    await this._updateSubject();
    await this.persistChanges("Subject Update");
    await this.releaseAllLocks();
    Logger.logInfo(LogCategory.PCF, "Completed Subject Update.");

    Logger.logInfo(LogCategory.PCF, "Started Data Update...");
    await this.acquireLock(this.jobSubjectId);
    await this._updateLoader();

    if (this.srcState !== pcf.ItemState.Unchanged) {
      this._updateCodeSpecs();

      await this._loadIRModel();
      await this.irModel.load();
      await this._updateData();
      await this.irModel.clear();

      await this._deleteData();
      await this._updateProjectExtents();
    } else {
      Logger.logInfo(LogCategory.PCF, "Source data has not changed. Skip data update.");
    }
    await this.persistChanges("Data Update");
    await this.releaseAllLocks();
    Logger.logInfo(LogCategory.PCF, "Completed Data Update.");

    Logger.logInfo(LogCategory.PCF, "Your Connector Job has completed");
  }

  protected async _updateLoader(): Promise<pcf.SyncResult> {
    const loaderNode = this.tree.find<pcf.LoaderNode>(this.jobArgs.connection.loaderNodeKey, pcf.LoaderNode);
    await loaderNode.model.sync();
    const result = await loaderNode.sync() as pcf.SyncResult;
    Logger.logInfo(LogCategory.PCF, `Loader State = ${pcf.ItemState[result.state]}`);
    this._srcState = result.state;
    return result;
  }

  protected async _updateSubject(): Promise<pcf.SyncResult> {
    const subjectNode = this.tree.find<pcf.SubjectNode>(this.jobArgs.subjectNodeKey, pcf.SubjectNode);
    const result = await subjectNode.sync() as pcf.SyncResult;
    Logger.logInfo(LogCategory.PCF, `Subject State = ${pcf.ItemState[result.state]}`);
    this._jobSubjectId = result.entityId;
    this.elementCache[subjectNode.key] = this.jobSubjectId;
    return result;
  }

  protected async _updateDomainSchema(): Promise<any> {
    const { domainSchemaPaths } = this.config;
    if (domainSchemaPaths.length > 0)
      await this.db.importSchemas(domainSchemaPaths);
  }

  protected async _updateDynamicSchema(): Promise<any> {
    const { entityMap: dynamicEntityMap } = this.tree;
    const shouldGenerateSchema = dynamicEntityMap.entities.length + dynamicEntityMap.relationships.length > 0;
    if (shouldGenerateSchema) {
      if (!this.config.dynamicSchema)
        throw new Error("dynamic schema setting is missing to generate a dynamic schema.");
      const { schemaName, schemaAlias } = this.config.dynamicSchema;
      const domainSchemaNames = this.config.domainSchemaPaths.map((filePath: any) => path.basename(filePath, ".ecschema.xml"));
      const schemaState = await pcf.syncDynamicSchema(this.db, domainSchemaNames, { schemaName, schemaAlias, dynamicEntityMap });
      Logger.logInfo(LogCategory.PCF, `Dynamic Schema State: ${pcf.ItemState[schemaState]}`);
      const generatedSchema = await pcf.tryGetSchema(this.db, schemaName);
      if (!generatedSchema)
        throw new Error("Failed to find dynamically generated schema.");
    }
  }

  protected async _loadIRModel() {
    const node = this.tree.find<pcf.LoaderNode>(this.jobArgs.connection.loaderNodeKey, pcf.LoaderNode);
    const loader = node.loader;
    this._irModel = new pcf.IRModel(loader, this.jobArgs.connection);
  }

  protected async _updateData() {
    let n = 0;
    const nodes = this.tree.getNodes(this.jobArgs.subjectNodeKey);
    for (const node of nodes) {
      if (!node.isSynced) {
        const result = await node.sync();
        if (Array.isArray(result))
          n += result.filter((r: pcf.SyncResult) => r.state !== pcf.ItemState.Unchanged).length;
        else
          n += 1;
      }
    }
    Logger.logInfo(LogCategory.PCF, `Number of updated EC Entity Instances: ${n}`);
  }

  protected async _deleteData() {
    if (!this.jobArgs.enableDelete) {
      Logger.logWarning(LogCategory.PCF, "Element deletion is disabled. Skip element deletion.");
      return;
    }

    let nDeleted = 0;

    const deleteElementUniqueAspect = (elementId: string) => {
      const aspects = this.db.elements.getAspects(elementId, ElementUniqueAspect.classFullName);
      const aspectId = aspects[0].id;
      if (!aspectId || this.seenIdSet.has(aspectId))
        return;
      try {
        this.db.elements.deleteAspect(aspectId);
        nDeleted += 1;
      } catch (err) {
        Logger.logWarning(LogCategory.PCF, (err as IModelError).message);
      }
    }

    const elementEcsql = `SELECT aspect.Element.Id[elementId] FROM ${ExternalSourceAspect.classFullName} aspect WHERE aspect.Kind !='DocumentWithBeGuid'`;
    const elementRows = await util.getRows(this.db, elementEcsql);

    const elementIds: Id64String[] = [];
    const defElementIds: Id64String[] = [];

    for (const row of elementRows) {
      const elementId = row.elementId;
      if (this.seenIdSet.has(elementId))
        continue;
      const element = this.db.elements.getElement(elementId);
      if (element instanceof DefinitionElement)
        defElementIds.push(elementId);
      else
        elementIds.push(elementId);
    }

    for (const elementId of elementIds) {
      if (this.db.elements.tryGetElement(elementId)) {
        this.db.elements.deleteElement(elementId);
        nDeleted += 1;
        deleteElementUniqueAspect(elementId);
      }
    }

    for (const elementId of defElementIds) {
      if (this.db.elements.tryGetElement(elementId)) {
        this.db.elements.deleteDefinitionElements([elementId]);
        nDeleted += 1;
        deleteElementUniqueAspect(elementId);
      }
    }

    Logger.logInfo(LogCategory.PCF, `Number of deleted EC Entity Instances: ${nDeleted}`);
  }

  protected async _updateProjectExtents() {
    const options: ComputeProjectExtentsOptions = {
      reportExtentsWithOutliers: false,
      reportOutliers: false,
    };
    const result = this.db.computeProjectExtents(options);
    this.db.updateProjectExtents(result.extents);
  }

  protected _updateCodeSpecs() {
    const codeSpecName = PConnector.CodeSpecName;
    if (this.db.codeSpecs.hasName(codeSpecName))
      return;
    this.db.codeSpecs.insert(codeSpecName, CodeScopeSpec.Type.Model);
  }

  public async persistChanges(changeDesc: string) {
    const { revisionHeader } = this.jobArgs;
    const header = revisionHeader ? revisionHeader.substring(0, 400) : "itwin-pcf";
    const description = `${header} - ${changeDesc}`;
    if (this.db instanceof StandaloneDb || this.db instanceof SnapshotDb) {
      this.db.saveChanges();
    } else if (this.db instanceof BriefcaseDb) {
      this.db.saveChanges();
      await this.db.pushChanges({ description } as PushChangesArgs);
    }
  }

  public async acquireLock(rootId: Id64String) {
    if (this.db instanceof StandaloneDb || this.db instanceof SnapshotDb)
      return;
    await this.db.locks.acquireExclusiveLock(rootId);
  }

  public async releaseAllLocks() {
    if (this.db instanceof StandaloneDb || this.db instanceof SnapshotDb)
      return;
    await this.db.locks.releaseAllLocks();
  }

  public syncProvenance(arg: pcf.SyncArg): pcf.ItemState {
    const { props, version, checksum, scope, kind, identifier } = arg;
    const { aspectId } = ExternalSourceAspect.findBySource(this.db, scope, kind, identifier);
    if (!aspectId) {
      this.db.elements.insertAspect({
        classFullName: ExternalSourceAspect.classFullName,
        element: { id: props.id },
        scope: { id: scope },
        identifier,
        kind,
        checksum,
        version,
      } as ExternalSourceAspectProps);
      return pcf.ItemState.New;
    }

    const xsa: ExternalSourceAspect = this.db.elements.getAspect(aspectId) as ExternalSourceAspect;
    const existing = (xsa.version ?? "") + (xsa.checksum ?? "");
    const current = (version ?? "") + (checksum ?? "");
    if (existing === current)
      return pcf.ItemState.Unchanged;

    xsa.version = version;
    xsa.checksum = checksum;
    this.db.elements.updateAspect(xsa as ElementAspect);
    return pcf.ItemState.Changed;
  }

  public syncElement(arg: pcf.SyncArg): pcf.SyncResult {
    const { props } = arg;
    const existingElement = this.db.elements.tryGetElement(new Code(props.code));
    if (!existingElement) {
      const newElementId = this.db.elements.insertElement(props);
      props.id = newElementId;
    } else {
      props.id = existingElement.id; 
    }

    const state = this.syncProvenance(arg);
    if (state === pcf.ItemState.Changed)
      this.db.elements.updateElement(props);

    return { entityId: props.id, state, comment: "" };
  }

  // Not supported yet.
  // public syncElementMultiAspect(arg: pcf.SyncArg): pcf.SyncResult {}

  public syncElementUniqueAspect(arg: pcf.SyncArg): pcf.SyncResult {
    const { props } = arg;
    const aspects = this.db.elements.getAspects(props.element.id, props.classFullName);
    const existingAspect = aspects.length === 1 ? aspects[0] : undefined;
    if (!existingAspect) {
      this.db.elements.insertAspect(props);

      // store provenance on the element that the aspect attaches to
      // this is ok because ExternalSourceAspect (provenance) is a ElementMultiAspect
      props.id = props.element.id;
    } else {
      props.id = existingAspect.id;
    }

    const state = this.syncProvenance(arg);
    if (state === pcf.ItemState.Changed)
      this.db.elements.updateAspect(props);

    return { entityId: props.id, state, comment: "" };
  }

  public async getSourceTargetIdPair(node: pcf.RelatedElementNode | pcf.RelationshipNode, instance: pcf.IRInstance): Promise<{ sourceId: string, targetId: string } | undefined> {
    if (!node.dmo.fromAttr || !node.dmo.toAttr)
      return;

    let sourceId: Id64String | undefined;
    if (node.source && node.dmo.fromType === "IREntity") {
      const sourceModelId = this.modelCache[node.source.model.key];
      const sourceValue = instance.get(node.dmo.fromAttr);
      if (!sourceValue)
        return undefined;
      const sourceCode = this.getCode(node.source.dmo.irEntity, sourceModelId, sourceValue);
      sourceId = this.db.elements.queryElementIdByCode(sourceCode);
    } else if (node.dmo.fromType === "ECEntity") {
      const result = await pcf.locateElement(this.db, instance.data[node.dmo.fromAttr]) as pcf.LocateResult;
      if (result.error) {
        Logger.logWarning(LogCategory.PCF, `Could not find the source EC entity for relationship instance = ${instance.key}: ${result.error}`);
        return undefined;
      }
      sourceId = result.elementId;
    }

    let targetId: Id64String | undefined;
    if (node.target && node.dmo.toType === "IREntity") {
      const targetModelId = this.modelCache[node.target.model.key];
      const targetValue = instance.get(node.dmo.toAttr);
      if (!targetValue)
        return undefined;
      const targetCode = this.getCode(node.target.dmo.irEntity, targetModelId, targetValue);
      targetId = this.db.elements.queryElementIdByCode(targetCode);
    } else if (node.dmo.toType === "ECEntity") {
      const result = await pcf.locateElement(this.db, instance.data[node.dmo.toAttr]) as pcf.LocateResult;
      if (result.error) {
        Logger.logWarning(LogCategory.PCF, `Could not find the target EC entity for relationship instance = ${instance.key}: ${result.error}`);
        return undefined;
      }
      targetId = result.elementId;
    }

    if (!sourceId) {
      Logger.logWarning(LogCategory.PCF, `Could not find the source IR entity for relationship instance = ${instance.key}`);
      return undefined;
    }
    if (!targetId) {
      Logger.logWarning(LogCategory.PCF, `Could not find target IR entity for relationship instance = ${instance.key}`);
      return undefined;
    }

    return { sourceId, targetId };
  }

  public getCode(entityKey: string, modelId: Id64String, value: string): Code {
    const codeValue = `${entityKey}-${value}` as pcf.IRInstanceKey;
    return new Code({spec: this.defaultCodeSpec.id, scope: modelId, value: codeValue});
  }

  public get defaultCodeSpec(): CodeSpec {
    if (!this.db.codeSpecs.hasName(PConnector.CodeSpecName))
      throw new Error("Default CodeSpec is not in iModel");
    const codeSpec: CodeSpec = this.db.codeSpecs.getByName(PConnector.CodeSpecName);
    return codeSpec;
  }

  public subjectOwnsEcInstanceId() {

  }
}
