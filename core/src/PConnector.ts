import { Id64String, Logger } from "@bentley/bentleyjs-core"; 
import { AuthorizedBackendRequestContext, BackendRequestContext, BriefcaseDb, ComputeProjectExtentsOptions, DefinitionElement, ElementAspect, ExternalSourceAspect, IModelDb, Subject, RepositoryLink } from "@bentley/imodeljs-backend";
import { Schema as MetaSchema } from "@bentley/ecschema-metadata";
import { Code, CodeScopeSpec, CodeSpec, ExternalSourceAspectProps, IModel, RepositoryLinkProps, ElementProps } from "@bentley/imodeljs-common";
import { ChangesType } from "@bentley/imodelhub-client";
import { LogCategory } from "./LogCategory";
import { IRInstanceKey } from "./IRModel";
import { Loader } from "./loaders";
import * as util from "./Util";
import * as pcf from "./pcf";
import * as fs from "fs";
import * as path from "path";
import { IRInstance, JobArgs, UpdateResult } from "./pcf";

export enum ItemState {
  Unchanged,
  New,
  Changed,
}

export interface PConnectorConfigProps {
  appId: string;
  appVersion: string;
  connectorName: string;
  domainSchemaPaths?: string[];
  dynamicSchema?: {
    schemaName: string;
    schemaAlias: string;
  }
}

// Be extreme cautious when editing your connector config. Mistakes could potentially corrupt your iModel.
export class PConnectorConfig implements PConnectorConfigProps {
  // application ID
  public appId: string;
  // application version
  public appVersion: string;
  // the name of your connector (e.g. COBieConnector)
  public connectorName: string;
  // Local paths to the domain xml schemas referenced. Leave this empty if only BisCore Schema is used.
  public domainSchemaPaths: string[] = [];
  // dynamic schema settings
  public dynamicSchema?: {
    // The name of your Dynamic Schema if any. (e.g. 'COBieDynamic')
    schemaName: string;
    // The alias of your Dynamic Schema name if any. (e.g. 'COBieDynamic' => 'cd')
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
  public seenIds: Set<Id64String>;

  public tree: pcf.RepoTree;
  public nodeMap: { [nodeKey: string]: pcf.Node };
  protected _config?: PConnectorConfig;

  public dynamicSchema?: MetaSchema;

  // initialized by runJob()
  protected _db?: IModelDb;
  protected _jobArgs?: JobArgs;
  protected _jobSubjectId?: Id64String;
  protected _irModel?: pcf.IRModel;
  protected _authReqContext?: AuthorizedBackendRequestContext;
  protected _srcState?: ItemState;

  constructor() {
    this.subjectCache = {};
    this.modelCache = {};
    this.elementCache = {};
    this.aspectCache = {};
    this.seenIds = new Set<Id64String>();
    this.nodeMap = {};
    this.tree = new pcf.RepoTree();
  }

  public get config() {
    if (!this._config)
      throw new Error("PConnectorConfig must be defined in the constructor of your connector class");
    return this._config;
  } 

  public set config(config: PConnectorConfig) {
    this._config = config;
  } 

  public get db() {
    if (!this._db) 
      throw new Error("IModelDb is undefined");
    return this._db;
  }

  public get jobArgs() {
    if (!this._jobArgs) 
      throw new Error("JobArgs is undefined");
    return this._jobArgs;
  }

  public get authReqContext() {
    if (!this._authReqContext) 
      throw new Error("reqContext is undefined");
    return this._authReqContext;
  }

  public get reqContext() {
    if (this.db.isBriefcaseDb()) {
      if (!this._authReqContext) 
        throw new Error("reqContext is undefined");
      return this._authReqContext;
    }
    return new BackendRequestContext();
  }

  public get jobSubjectId() {
    if (!this._jobSubjectId) 
      throw new Error("job subject id is undefined. call updateSubject to populate its value.");
    return this._jobSubjectId;
  }

  public get irModel() {
    if (!this._irModel) 
      throw new Error("irModel has not been initialized. call loadIRModel to populate its value.");
    return this._irModel;
  }

  public get srcState() {
    if (this._srcState === undefined) 
      throw new Error("srcState is undefined. call updateLoader to populate its value.");
    return this._srcState;
  }

  public set srcState(state: ItemState) {
    this._srcState = state;
  }

  public init(props: { db: IModelDb, jobArgs: JobArgs, authReqContext?: AuthorizedBackendRequestContext }): void {
    this.modelCache = {};
    this.elementCache = {};
    this.aspectCache = {};
    this.seenIds = new Set<Id64String>();

    this._db = props.db;
    this._jobArgs = props.jobArgs;
    this._authReqContext = props.authReqContext;

    if (this.db.isBriefcaseDb())
      this.db.concurrencyControl.startBulkMode();
  }

  public async runJob(): Promise<void> {

    this.tree.validate(this.jobArgs);

    Logger.logInfo(LogCategory.PCF, "Your Connector Job has started");

    await this._updateLoader();
    await this._updateSubject();
    await this._updateDomainSchema();
    await this._updateDynamicSchema();

    if (this.srcState !== ItemState.Unchanged) {
      await this._loadIRModel();
      await this._updateData();
      await this._updateDeletedElements();
      await this._updateProjectExtents();
    }

    Logger.logInfo(LogCategory.PCF, "Your Connector Job has finished");
  }

  public async save() {
    const tree = this.tree.toJSON();
    const compressed = { tree, config: this.config };
    fs.writeFileSync(path.join(process.cwd(), "tree.json"), JSON.stringify(compressed, null, 4) , "utf-8");
  }

  protected async _updateLoader() {
    if (this.db.isBriefcaseDb())
      await this.enterChannel(IModel.repositoryModelId);

    const loader = this.tree.getLoader(this.jobArgs.connection.loaderKey);
    await loader.update();

    await this.persistChanges(`Updated Loader (Repository Link) - ${loader.key}`, ChangesType.GlobalProperties);
  }

  public updateElement(props: ElementProps, instance: IRInstance): UpdateResult {
    const identifier = props.code.value!;
    const version = instance.version;
    const checksum = instance.checksum;
    const existingElement = this.db.elements.tryGetElement(new Code(props.code));
    const element = this.db.elements.createElement(props);
    if (existingElement)
      element.id = existingElement.id;

    const { aspectId } = ExternalSourceAspect.findBySource(this.db, element.model, instance.entityKey, identifier);
    if (!aspectId) {
      element.insert();
      this.db.elements.insertAspect({
        classFullName: ExternalSourceAspect.classFullName,
        element: { id: element.id },
        scope: { id: element.model },
        identifier,
        kind: instance.entityKey,
        checksum,
        version,
      } as ExternalSourceAspectProps);
      return { entityId: element.id, state: ItemState.New };
    }

    const xsa: ExternalSourceAspect = this.db.elements.getAspect(aspectId) as ExternalSourceAspect;
    const existing = (xsa.version ?? "") + (xsa.checksum ?? "");
    const current = (version ?? "") + (checksum ?? "");
    if (existing === current)
      return { entityId: element.id, state: ItemState.Unchanged };

    xsa.version = version;
    xsa.checksum = checksum;

    element.update();
    this.db.elements.updateAspect(xsa as ElementAspect);
    return { entityId: element.id, state: ItemState.Changed };
  }

  protected async _updateSubject() {
    if (this.db.isBriefcaseDb())
      await this.enterChannel(IModel.repositoryModelId);

    const subjectKey = this.jobArgs.subjectKey;
    const subjectNode = this.tree.getSubjectNode(subjectKey);
    const { entityId } = await subjectNode.update();
    this._jobSubjectId = entityId;

    await this.persistChanges(`Updated Subject - ${subjectKey}`, ChangesType.GlobalProperties);
  }

  protected async _updateDomainSchema(): Promise<any> {
    if (this.db.isBriefcaseDb())
      await this.enterChannel(IModel.repositoryModelId);

    const { domainSchemaPaths } = this.config;
    if (domainSchemaPaths.length > 0)
      await this.db.importSchemas(this.reqContext, domainSchemaPaths);

    await this.persistChanges(`Imported ${domainSchemaPaths.length} Domain Schema(s)`, ChangesType.Schema);
  }

  protected async _loadIRModel() {
    const loader = this.tree.getLoader(this.jobArgs.connection.loaderKey);
    await loader.open(this.jobArgs.connection);
    this._irModel = await pcf.IRModel.fromLoader(loader);
  }

  protected async _updateDynamicSchema(): Promise<any> {
    const dmoMap = this.tree.buildDMOMap();
    const shouldGenerateSchema = dmoMap.elements.length + dmoMap.relationships.length + dmoMap.relatedElements.length > 0;

    if (shouldGenerateSchema) {

      if (this.db.isBriefcaseDb())
        await this.enterChannel(IModel.repositoryModelId);

      if (!this.config.dynamicSchema)
        throw new Error("dynamic schema setting is missing to generate a dynamic schema.");

      const { schemaName, schemaAlias } = this.config.dynamicSchema;
      const domainSchemaNames = this.config.domainSchemaPaths.map((filePath: any) => path.basename(filePath, ".ecschema.xml"));
      const schemaState = await pcf.syncDynamicSchema(this.db, this.reqContext, domainSchemaNames, { schemaName, schemaAlias, dmoMap });
      const generatedSchema = await pcf.tryGetSchema(this.db, schemaName);
      if (!generatedSchema)
        throw new Error("Failed to find dynamically generated schema.");

      this.dynamicSchema = generatedSchema
      if (schemaState === ItemState.New)
        await this.persistChanges("Added a Dynamic Schema", ChangesType.Schema);
      else if (schemaState === ItemState.Changed)
        await this.persistChanges("Updated Existing Dynamic Schema", ChangesType.Schema);
      else 
        await this.persistChanges("No Changes to Dynamic Schema", ChangesType.Schema);
    }
  }

  protected async _updateData() {
    if (this.db.isBriefcaseDb())
      await this.enterChannel(this.jobSubjectId);

    const subjectKey = this.jobArgs.subjectKey;
    const subjectNode = this.tree.getSubjectNode(subjectKey);

    this._updateCodeSpecs();
    for (const topModel of subjectNode.models) {
      if (topModel.subject.key !== subjectKey)
        continue;
      await topModel.update();
      for (const element of topModel.elements) {
        await element.update();
      }
    }

    for (const relationship of this.tree.relationships)
      await relationship.update();
    for (const relatedElement of this.tree.relatedElements)
      await relatedElement.update();

    await this.persistChanges("Updated Data", ChangesType.Regular);
  }

  protected async _updateDeletedElements(): Promise<void> {
    if (!this.jobArgs.enableDelete) {
      Logger.logWarning(LogCategory.PCF, "Element deletion is disabled. Skip deleting elements.");
      return;
    }

    if (this.db.isBriefcaseDb())
      await this.enterChannel(this.jobSubjectId);

    const ecsql = `SELECT aspect.Element.Id[elementId] FROM ${ExternalSourceAspect.classFullName} aspect WHERE aspect.Kind !='DocumentWithBeGuid'`;
    const rows = await util.getRows(this.db, ecsql);

    const elementIds: Id64String[] = [];
    const defElementIds: Id64String[] = [];

    for (const row of rows) {
      const elementId = row.elementId;
      if (this.seenIds.has(elementId))
        continue;
      if (this.db.isBriefcaseDb()) {
        const elementChannelRoot = this.db.concurrencyControl.channel.getChannelOfElement(this.db.elements.getElement(elementId));
        const elementNotInChannelRoot = elementChannelRoot.channelRoot !== this.db.concurrencyControl.channel.channelRoot;
        if (elementNotInChannelRoot)
          continue;
      }
      const element = this.db.elements.getElement(elementId);
      if (element instanceof DefinitionElement)
        defElementIds.push(elementId);
      else
        elementIds.push(elementId);
    }

    this.db.elements.deleteElement(elementIds);
    this.db.elements.deleteDefinitionElements(defElementIds);

    await this.persistChanges("Deleted Elements", ChangesType.Regular);
  }

  protected async _updateProjectExtents() {
    if (this.db.isBriefcaseDb())
      await this.enterChannel(this.jobSubjectId);

    const options: ComputeProjectExtentsOptions = {
      reportExtentsWithOutliers: false,
      reportOutliers: false,
    };
    const res = this.db.computeProjectExtents(options);
    this.db.updateProjectExtents(res.extents);

    await this.persistChanges("Updated Project Extents", ChangesType.Regular);
  }

  public async getSourceTargetIdPair(node: pcf.RelatedElementNode | pcf.RelationshipNode, instance: pcf.IRInstance): Promise<string[] | void> {

    if (!node.dmo.fromAttr || !node.dmo.toAttr)
      return;

    let sourceId;
    if (node.dmo.fromType === "IREntity") {
      const sourceModelId = this.modelCache[node.source.model.key];
      const sourceValue = instance.get(node.dmo.fromAttr);
      const sourceCode = this.getCode(node.source.dmo.irEntity, sourceModelId, sourceValue);
      sourceId = this.db.elements.queryElementIdByCode(sourceCode);
    }

    let targetId;
    if (node.dmo.toType === "IREntity") {
      const targetModelId = this.modelCache[node.target!.model.key];
      const targetValue = instance.get(node.dmo.toAttr);
      const targetCode = this.getCode(node.target!.dmo.irEntity, targetModelId, targetValue);
      targetId = this.db.elements.queryElementIdByCode(targetCode);
    } else if (node.dmo.toType === "ECEntity") {
      const result = await pcf.searchElement(this.db, instance.data[node.dmo.toAttr]) as pcf.SearchResult;
      if (result.error) {
        Logger.logWarning(LogCategory.PCF, `Could not find the target EC entity for relationship instance = ${instance.key}: ${result.error}`);
        return;
      }
      targetId = result.elementId;
    }

    if (!sourceId) {
      Logger.logWarning(LogCategory.PCF, `Could not find the source IR entity for relationship instance = ${instance.key}`);
      return;
    }
    if (!targetId) {
      Logger.logWarning(LogCategory.PCF, `Could not find target IR entity for relationship instance = ${instance.key}`);
      return;
    }

    return [sourceId, targetId];
  }

  public getCode(entityKey: string, modelId: Id64String, value: string): Code {
    const codeValue = `${entityKey}-${value}` as IRInstanceKey;
    return new Code({spec: this.defaultCodeSpec.id, scope: modelId, value: codeValue});
  }

  protected _updateCodeSpecs() {
    const codeSpecName = PConnector.CodeSpecName;
    if (this.db.codeSpecs.hasName(codeSpecName))
      return;
    const newCodeSpec = CodeSpec.create(this.db, codeSpecName, CodeScopeSpec.Type.Model);
    this.db.codeSpecs.insert(newCodeSpec);
  }

  public get defaultCodeSpec(): CodeSpec {
    if (!this.db.codeSpecs.hasName(PConnector.CodeSpecName))
      throw new Error("Default CodeSpec is not in iModel");
    const codeSpec: CodeSpec = this.db.codeSpecs.getByName(PConnector.CodeSpecName);
    return codeSpec;
  }

  public async persistChanges(changeDesc: string, ctype: ChangesType) {
    const { revisionHeader } = this.jobArgs;
    const header = revisionHeader ? revisionHeader.substring(0, 400) : "itwin-pcf";
    const comment = `${header} - ${changeDesc}`;
    if (this.db.isBriefcaseDb()) {
      await util.retryLoop(async () => {
        await (this.db as BriefcaseDb).concurrencyControl.request(this.authReqContext);
      });
      await util.retryLoop(async () => {
        await (this.db as BriefcaseDb).pullAndMergeChanges(this.authReqContext);
      });
      this.db.saveChanges(comment);
      await util.retryLoop(async () => {
        await (this.db as BriefcaseDb).pushChanges(this.authReqContext, comment, ctype);
      });
    } else {
      this.db.saveChanges(comment);
    }
  }

  public async enterChannel(rootId: Id64String) {
    await util.retryLoop(async () => {
      if ((this.db as BriefcaseDb).concurrencyControl.hasPendingRequests)
        throw new Error("has pending requests");
      if (!(this.db as BriefcaseDb).concurrencyControl.isBulkMode)
        throw new Error("not in bulk mode");
      if ((this.db as BriefcaseDb).concurrencyControl.locks.hasSchemaLock)
        throw new Error("has schema lock");
      if ((this.db as BriefcaseDb).concurrencyControl.locks.hasCodeSpecsLock)
        throw new Error("has code spec lock");
      if ((this.db as BriefcaseDb).concurrencyControl.channel.isChannelRootLocked)
        throw new Error("holds lock on current channel root. it must be released before entering a new channel.");
      (this.db as BriefcaseDb).concurrencyControl.channel.channelRoot = rootId;
      await (this.db as BriefcaseDb).concurrencyControl.channel.lockChannelRoot(this.authReqContext);
    });
  }
}

