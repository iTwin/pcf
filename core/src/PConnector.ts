/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { assert, Id64String, Logger } from "@itwin/core-bentley";
import { Code, CodeScopeSpec, CodeSpec, ElementAspectProps, ExternalSourceAspectProps, IModel, IModelError, RelatedElementProps } from "@itwin/core-common";
import { BriefcaseDb, Category, ComputeProjectExtentsOptions, DefinitionElement, ElementAspect, ElementUniqueAspect, ExternalSourceAspect, IModelDb, IModelHost, PushChangesArgs, SnapshotDb, StandaloneDb, SubjectOwnsPartitionElements } from "@itwin/core-backend";
import { ItemState, ModelNode, SubjectNode, SyncResult, IRInstance, IRInstanceKey, IRModel, JobArgs, LoaderNode, RelatedElementNode, RelationshipNode, RepoTree, SyncArg, syncDynamicSchema, tryGetSchema } from "./pcf";
import { LogCategory } from "./LogCategory";
import * as util from "./Util";
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
  };

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

/**
 * Tree-trimming statistics.
 */
export type Trim = {
    deletedElements: number,
    deletedModels: number,
    deletedAspects: number
};

export abstract class PConnector {

  public static CodeSpecName = "IREntityKey-PrimaryKeyValue";
  public readonly tree: RepoTree;

  protected _subjectCache: { [subjectNodeKey: string]: Id64String };
  protected _modelCache: { [modelNodeKey: string]: Id64String };
  protected _elementCache: { [instanceKey: string]: Id64String };
  protected _aspectCache: { [instanceKey: string]: Id64String };

  // Two sets are needed because ElementAspect has same ECInstanceId as its attached Element
  protected _seenElementIdSet: Set<Id64String>;
  protected _seenAspectIdSet: Set<Id64String>;

  protected _config?: PConnectorConfig;
  protected _db?: IModelDb;
  protected _jobArgs?: JobArgs;
  protected _irModel?: IRModel;
  protected _jobSubjectId?: Id64String;
  protected _srcState?: ItemState;

  /**
   * This is your connector's entry point. Define all of your nodes here. Also remember to add a
   * function to the module your connector lives in called `getConnectorInstance` that returns a
   * promise containing an instance of your connector, using {@link PConnector#form}. If your
   * connector does asynchronous work in {@link DMO!DMO#modifyProps}, for example
   *
   * ```ts
   * export async function getConnectorInstance(): Promise<MyConnector>
   * {
   *     const connector = new MyConnector();
   *     await connector.form();
   *     return connector;
   * }
   * ```
   *
   * `getConnectorInstance` isn't documented because it's part of the connector application
   * generated by PCF. In the future, we should consider not using `require` and pass the class type
   * to {@link BaseApp!BaseApp#runConnectorJob}.
   */
  public abstract form(): Promise<void>;

  constructor() {
    this.tree = new RepoTree();
    this._subjectCache = {};
    this._modelCache = {};
    this._elementCache = {};
    this._aspectCache = {};
    this._seenElementIdSet = new Set<Id64String>();
    this._seenAspectIdSet = new Set<Id64String>();
  }

  public get subjectCache() { return this._subjectCache; }
  public get modelCache() { return this._modelCache; }
  public get elementCache() { return this._elementCache; }
  public get aspectCache() { return this._aspectCache; }

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

  public onSyncSubject(result: SyncResult, node: SubjectNode) {
    this._subjectCache[node.key] = result.entityId;
  }

  public onSyncModel(result: SyncResult, node: ModelNode) {
    this._modelCache[node.key] = result.entityId;
  }

  public onSyncElement(result: SyncResult, instance: IRInstance) {
    this._elementCache[instance.key] = result.entityId;
    this._seenElementIdSet.add(result.entityId);
  }

  /**
   * What to do with the model part of a modeled element after it's synced. We only worry about
   * caching the `ECInstanceId` of the model, because the element is cached by
   * {@link PConnector#onSyncElement}.
   */
  public onSyncModeledElement(result: SyncResult, instance: IRInstance): void {
    this._modelCache[instance.key] = result.entityId;
  }

  public onSyncAspect(result: SyncResult, instance: IRInstance) {
    this._aspectCache[instance.key] = result.entityId;
    this._seenAspectIdSet.add(result.entityId);
  }

  public onSyncRelatedElement(result: SyncResult, instance: IRInstance) {}
  public onSyncRelationship(result: SyncResult, instance: IRInstance) {}

  public async runJobUnsafe(db: IModelDb, jobArgs: JobArgs): Promise<void> {
    this._modelCache = {};
    this._elementCache = {};
    this._aspectCache = {};
    this._seenElementIdSet = new Set<Id64String>();

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

    if (this.srcState !== ItemState.Unchanged) {
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

  protected async _updateLoader(): Promise<SyncResult> {
    const loaderNode = this.tree.find<LoaderNode>(this.jobArgs.connection.loaderNodeKey, LoaderNode);
    await loaderNode.model.sync();
    const result = await loaderNode.sync() as SyncResult;
    Logger.logInfo(LogCategory.PCF, `Loader State = ${ItemState[result.state]}`);
    this._srcState = result.state;
    return result;
  }

  protected async _updateSubject(): Promise<SyncResult> {
    const subjectNode = this.tree.find<SubjectNode>(this.jobArgs.subjectNodeKey, SubjectNode);
    const result = await subjectNode.sync() as SyncResult;
    Logger.logInfo(LogCategory.PCF, `Subject State = ${ItemState[result.state]}`);
    this._jobSubjectId = result.entityId;
    this._elementCache[subjectNode.key] = this.jobSubjectId;
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
      const schemaState = await syncDynamicSchema(this.db, domainSchemaNames, { schemaName, schemaAlias, dynamicEntityMap });
      Logger.logInfo(LogCategory.PCF, `Dynamic Schema State: ${ItemState[schemaState]}`);
      const generatedSchema = await tryGetSchema(this.db, schemaName);
      if (!generatedSchema)
        throw new Error("Failed to find dynamically generated schema.");
    }
  }

  protected async _loadIRModel() {
    const node = this.tree.find<LoaderNode>(this.jobArgs.connection.loaderNodeKey, LoaderNode);
    const loader = node.loader;
    this._irModel = new IRModel(loader, this.jobArgs.connection);
  }

  protected async _updateData() {
    let nUpdated = 0;
    const nodes = this.tree.getNodes(this.jobArgs.subjectNodeKey);
    for (const node of nodes) {
      if (!node.isSynced) {
        const result = await node.sync();
        if (Array.isArray(result))
          nUpdated += result.filter((r: SyncResult) => r.state !== ItemState.Unchanged).length;
        else
          nUpdated += 1;
      }
    }
    Logger.logInfo(LogCategory.PCF, `Number of updated EC Entity Instances: ${nUpdated}`);
  }

  protected async _deleteData() {
    if (!this.jobArgs.enableDelete) {
      Logger.logWarning(LogCategory.PCF, "Deletion is disabled. Skip it.");
      return;
    }

    const stats = this.trimTree(this.jobSubjectId);
    const total = stats.deletedElements + stats.deletedAspects;

    Logger.logInfo(LogCategory.PCF, `Number of deleted EC Entity Instances: ${total}`);

    return total;
  }

  /**
   * 'Managed' aspects are those that store their provenance on the element they're connected to.
   * PCF does this to allow aspects to be updated and deleted independently of their element. If
   * you're a BIS purist this approach isn't for you, but the alternative is having no provenance
   * information for aspects.
   */
  private deleteManagedAspects(element: Id64String): number {
    const aspects = this.db.elements.getAspects(element);

    let deleted = 0;
    for (const aspect of aspects) {
      const notProvenance = aspect.className !== ExternalSourceAspect.className;
      if (notProvenance && !this._seenAspectIdSet.has(aspect.id)) {
        deleted += 1;
        this.db.elements.deleteAspect(aspect.id);
      }
    }

    return deleted;
  }

  /**
   * Trim the iModel tree rooted at the given branch, the `ECInstanceId` of an element or model.
   * This method deletes all elements and models that have not been seen by the synchronizer, and
   * whose children have not been seen.
   *
   * This method is a transplant from [`fir`](https://github.com/jackson-at-bentley/fir).
   * For details about this method,
   * [please see the documentation](https://jackson-at-bentley.github.io/fir/classes/sync.Sync.html#trim).
   *
   * This method is expected to be replaced by a dedicated class from the iTwin library when it is
   * made available.
   */
  private trimTree(branch: Id64String): Trim
  {
    // There are only two kinds of elements in BIS: modeled elements and parent elements.
    // See also: https://www.itwinjs.org/bis/intro/modeling-with-bis/#relationships

    // We perform a post-order traversal down the channel, because we must ensure that every
    // child is deleted before its parent, and every model before its modeled element.

    let children: Id64String[];

    let deletedElements = 0;
    let deletedModels = 0;
    let deletedAspects = 0;

    const model = this.db.models.tryGetSubModel(branch);
    const isElement = model === undefined;

    if (isElement) {
        // The element is a parent element.
        children = childrenOfElement(this.db, branch);
    } else {
        // The element is a modeled element.
        children = childrenOfModel(this.db, model.id);
    }

    children.forEach((child) => {
        const deleted = this.trimTree(child);
        deletedElements += deleted.deletedElements;
        deletedModels += deleted.deletedModels;
        deletedAspects += deleted.deletedAspects;
    });

    // If all elements were deleted successfully, delete the parent.

    const element = this.db.elements.getElement(branch);
    let remainingChildren: Id64String[];

    if (isElement) {
        this.deleteManagedAspects(branch);
        remainingChildren = childrenOfElement(this.db, branch);
    } else {
        remainingChildren = childrenOfModel(this.db, model.id);
    }

    // A category will have an unmanaged default subcategory. If we don't see the category, and its
    // managed subcategories are deleted, we forcibly delete this subcategory.

    const managed = isManaged(this.db, branch);
    const seen = this._seenElementIdSet.has(branch);
    const subcategoryWithDefault = element instanceof Category && remainingChildren.length === 1;
    const noChildren = remainingChildren.length === 0 || subcategoryWithDefault;

    if (managed && !seen && noChildren) {
      Logger.logTrace(LogCategory.PCF, `Visiting element ${branch} :: ${element.classFullName} (proto. ${Object.getPrototypeOf(element).constructor.name}); definition? ${element instanceof DefinitionElement}`);

      if (isElement) {
        // Note that although ReturnType<backend.getElement> :: backend.Element, the backend does
        // some weird stuff and is able to construct the corresponding *class type* in iTwin's
        // libraries. This means that the element's prototype chain is intact despite its type being
        // narrowed to backend.Element. We can filter the element using instanceof.

        // Aspects are owned, i.e., their lifetime is managed by their owning element. When we
        // delete the element, the aspects are deleted, so we count them in advance before letting
        // the backend loose.

        if (element instanceof DefinitionElement) {
          Logger.logTrace(LogCategory.PCF, `Try deleting definition ${element.id} :: ${element.className}; label: ${element.userLabel}`);

          const aspects = this.db.elements.getAspects(branch).length;
          const inUse = this.db.elements.deleteDefinitionElements([branch]).size;

          if (inUse === 0) {
            Logger.logTrace(LogCategory.PCF, `  Success!`);
            deletedElements += 1;
            if (element instanceof Category) {
                deletedElements += 1; // The default subcategory.
            }

            deletedAspects += aspects;
          }
        } else {
          Logger.logTrace(LogCategory.PCF, `Deleting element ${element.id} :: ${element.className}; label: ${element.userLabel}`);

          deletedElements += 1;
          deletedAspects += this.db.elements.getAspects(branch).length;

          this.db.elements.deleteElement(branch);
        }
      } else {
        // If we've deleted all the immediate children of the model, delete both the modeled element
        // and the model.

        Logger.logTrace(LogCategory.PCF, `Deleting model ${model.id} :: ${model.className}`);

        deletedElements += 1;
        deletedModels += 1;
        deletedAspects += this.db.elements.getAspects(branch).length;

        this.db.models.deleteModel(model.id);
        this.db.elements.deleteElement(branch);
      }
    }

    return { deletedElements, deletedModels, deletedAspects };
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

        await this.db.locks.acquireLocks({exclusive: rootId});
  }

  public async releaseAllLocks() {
    if (this.db instanceof StandaloneDb || this.db instanceof SnapshotDb)
      return;
    await this.db.locks.releaseAllLocks();
  }

  public syncProvenance(arg: SyncArg): ItemState {
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
      return ItemState.New;
    }

    const xsa = this.db.elements.getAspect(aspectId) as ExternalSourceAspect;
    const existing = (xsa.version ?? "") + (xsa.checksum ?? "");
    const current = (version ?? "") + (checksum ?? "");
    if (existing === current)
      return ItemState.Unchanged;

    xsa.version = version;
    xsa.checksum = checksum;
    this.db.elements.updateAspect(xsa as unknown as ElementAspectProps);
    return ItemState.Changed;
  }

  public syncElement(arg: SyncArg): SyncResult {
    const { props } = arg;
    const existingElement = this.db.elements.tryGetElement(new Code(props.code));
    if (!existingElement) {
      const newElementId = this.db.elements.insertElement(props);
      props.id = newElementId;
    } else {
      props.id = existingElement.id;
    }

    const state = this.syncProvenance(arg);
    if (state === ItemState.Changed)
      this.db.elements.updateElement(props);

    return { entityId: props.id, state, comment: "" };
  }

  // Not supported yet.
  // public syncElementMultiAspect(arg: SyncArg): SyncResult {}

  public syncElementUniqueAspect(arg: SyncArg): SyncResult {
    const { props } = arg;
    const aspects = this.db.elements.getAspects(props.element.id, props.classFullName);
    const existingAspect = aspects.length === 1 ? aspects[0] : undefined;

    // The `id` of the `props` argument becomes the element to which the external source aspect
    // attaches in {@link PConnector#syncProvenance}. It's confusing.

    // Store provenance on the element that the aspect attaches to; okay because
    // bis:ExternalSourceAspect derives from bis:ElementMultiAspect.

    const state = this.syncProvenance({ ...arg, props: { ...props, id: props.element.id } });

    // Detect if the unique aspect has _moved_ to a different element in the source data. This means
    // we'll be unable to locate the original aspect in the iModel using the updated aspect in the
    // source. However, it will get cleaned up by the deletion pass of the synchronizer. We still
    // have to manually move the provenance over to the new element. Unfortunately, `updateAspect`
    // does not update the element's navigation property.

    // - A test for this particular failure: https://github.com/iTwin/itwinjs-core/pull/4227.
    // - Known issues with the aspect API: https://github.com/iTwin/itwinjs-core/issues/3969.

    if (!existingAspect && state === ItemState.Changed) {
      const { scope, kind, identifier } = arg;
      const { aspectId: foundId } = ExternalSourceAspect.findBySource(this.db, scope, kind, identifier);
      assert(foundId !== undefined);
      this.db.elements.deleteAspect(foundId);
      this.syncProvenance({ ...arg, props: { ...props, id: props.element.id } });
    }

    if (!existingAspect) {
      this.db.elements.insertAspect(props);
      const newAspect = this.db.elements.getAspects(props.element.id, props.classFullName)[0];
      props.id = newAspect.id;
    } else {
      props.id = existingAspect.id;
    }

    if (state === ItemState.Changed) {
      this.db.elements.updateAspect(props);
    }

    return { entityId: props.id, state, comment: "" };
  }

  public async getSourceTargetIdPair(node: RelatedElementNode | RelationshipNode, instance: IRInstance): Promise<{ sourceId: string, targetId: string } | undefined> {
    if (!node.dmo.fromAttr || !node.dmo.toAttr)
      return;

    let sourceId: Id64String | undefined;
    if (node.source && node.dmo.fromType === "IREntity") {
      const sourceModelId = this._modelCache[node.source.model.key];
      const sourceValue = instance.get(node.dmo.fromAttr);
      if (!sourceValue)
        return undefined;
      const sourceCode = this.getCode(node.source.dmo.irEntity, sourceModelId, sourceValue);
      sourceId = this.db.elements.queryElementIdByCode(sourceCode);
    } else if (node.dmo.fromType === "ECEntity") {
      const result = await util.locateElement(this.db, instance.data[node.dmo.fromAttr]) as util.LocateResult;
      if (result.error) {
        Logger.logWarning(LogCategory.PCF, `Could not find the source EC entity for relationship instance = ${instance.key}: ${result.error}`);
        return undefined;
      }
      sourceId = result.elementId;
    }

    let targetId: Id64String | undefined;
    if (node.target && node.dmo.toType === "IREntity") {
      const targetModelId = this._modelCache[node.target.model.key];
      const targetValue = instance.get(node.dmo.toAttr);
      if (!targetValue)
        return undefined;
      const targetCode = this.getCode(node.target.dmo.irEntity, targetModelId, targetValue);
      targetId = this.db.elements.queryElementIdByCode(targetCode);
    } else if (node.dmo.toType === "ECEntity") {
      const result = await util.locateElement(this.db, instance.data[node.dmo.toAttr]) as util.LocateResult;
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
    const codeValue = `${entityKey}-${value}` as IRInstanceKey;
    return new Code({spec: this.defaultCodeSpec.id, scope: modelId, value: codeValue});
  }

  public get defaultCodeSpec(): CodeSpec {
    if (!this.db.codeSpecs.hasName(PConnector.CodeSpecName))
      throw new Error("Default CodeSpec is not in iModel");
    const codeSpec: CodeSpec = this.db.codeSpecs.getByName(PConnector.CodeSpecName);
    return codeSpec;
  }
}

/**
 * Return the iModel IDs of the immediate children of a model.
 * @param imodel
 * @param model The model containing the desired children.
 * @returns A list of iModel IDs of the immediate children.
 */
function childrenOfModel(imodel: IModelDb, model: Id64String): Id64String[]
{
  const query = "select ECInstanceId from bis:Element where Model.id = ? and Parent is null";

    return imodel.withPreparedStatement(query, (statement) => {
        const elements: Id64String[] = [];

        statement.bindId(1, model);
        for (const row of statement) {
            elements.push(row.id);
        }

        return elements;
    });
}

/**
 * Return the iModel IDs of the immediate children of an element.
 * @param imodel
 * @param element The element that owns the desired children.
 * @returns A list of iModel IDs of the immediate children.
 */
function childrenOfElement(imodel: IModelDb, element: Id64String): Id64String[]
{
    const query = "select ECInstanceId from bis:Element where Parent.id = ?";

    return imodel.withPreparedStatement(query, (statement) => {
        const elements: Id64String[] = [];

        statement.bindId(1, element);
        for (const row of statement) {
            elements.push(row.id);
        }

        return elements;
    });
}

/**
 * Is this element managed by the synchronizer? In other words, does it have an external source
 * aspect? If it doesn't, the synchronizer absolutely should not delete it. As far as it is
 * concerned, it doesn't exist.
 * @param imodel
 * @param element The element to inspect.
 * @returns Does the element have at least one external source aspect?
 */
function isManaged(imodel: IModelDb, element: Id64String): boolean
{
    const query = "select count(*) from bis:ExternalSourceAspect where Element.id = ?";

    return imodel.withPreparedStatement(query, (statement) => {
        statement.bindId(1, element);
        statement.step();

        const count = statement.getValue(0);

        if (count.isNull) {
            return false;
        }

        return count.getInteger() > 0;
    });
}
