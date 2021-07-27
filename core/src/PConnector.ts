/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { Id64String, Logger } from "@bentley/bentleyjs-core"; 
import { AuthorizedBackendRequestContext, BackendRequestContext, BriefcaseDb, ComputeProjectExtentsOptions, DefinitionElement, ElementAspect, ExternalSourceAspect, IModelDb } from "@bentley/imodeljs-backend";
import { Code, CodeScopeSpec, CodeSpec, ExternalSourceAspectProps, IModel, ElementProps } from "@bentley/imodeljs-common";
import { ChangesType } from "@bentley/imodelhub-client";
import { AuthorizedClientRequestContext } from "@bentley/itwin-client";
import { BridgeJobDefArgs, IModelBridge } from "@bentley/imodel-bridge";
import { LogCategory } from "./LogCategory";
import * as util from "./Util";
import * as pcf from "./pcf";
import * as fs from "fs";
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

export abstract class PConnector extends IModelBridge {

  public static CodeSpecName: string = "IREntityKey-PrimaryKeyValue";

  public subjectCache: { [subjectNodeKey: string]: Id64String };
  public modelCache: { [modelNodeKey: string]: Id64String };
  public elementCache: { [instanceKey: string]: Id64String };
  public aspectCache: { [instanceKey: string]: Id64String };
  public seenIds: Set<Id64String>;

  public readonly tree: pcf.RepoTree;
  public readonly nodeMap: { [nodeKey: string]: pcf.Node };

  protected _config?: PConnectorConfig;
  protected _db?: IModelDb;
  protected _jobArgs?: pcf.JobArgs;
  protected _authReqContext?: AuthorizedBackendRequestContext;
  protected _irModel?: pcf.IRModel;
  protected _jobSubjectId?: Id64String;
  protected _srcState?: pcf.ItemState;

  constructor() {
    super();
    this.subjectCache = {};
    this.modelCache = {};
    this.elementCache = {};
    this.aspectCache = {};
    this.seenIds = new Set<Id64String>();
    this.tree = new pcf.RepoTree();
    this.nodeMap = {};
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

  public get authReqContext() {
    if (!this._authReqContext) 
      throw new Error("Authorized Request Context is not assigned");
    return this._authReqContext;
  }

  public get reqContext() {
    if (this.db.isBriefcaseDb()) {
      if (!this._authReqContext) 
        throw new Error("Authorized Request Context is not passed in by BaseApp.");
      return this._authReqContext;
    }
    return new BackendRequestContext();
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

  public async save() {
    const tree = this.tree.toJSON();
    const compressed = { tree, config: this.config };
    fs.writeFileSync(path.join(process.cwd(), "tree.json"), JSON.stringify(compressed, null, 4) , "utf-8");
  }

  public init(props: { db: IModelDb, jobArgs: pcf.JobArgs, authReqContext?: AuthorizedBackendRequestContext }): void {
    this.modelCache = {};
    this.elementCache = {};
    this.aspectCache = {};
    this.seenIds = new Set<Id64String>();

    this._db = props.db;
    this._jobArgs = props.jobArgs;
    this._authReqContext = props.authReqContext;
  }

  public async runJob(): Promise<void> {

    this.tree.validate(this.jobArgs);

    Logger.logInfo(LogCategory.PCF, "Your Connector Job has started");

    Logger.logInfo(LogCategory.PCF, "Started Domain Schema Update...");
    await this.enterChannel(IModel.repositoryModelId);
    await this._updateDomainSchema();
    await this.persistChanges(`Domain Schema Update`, ChangesType.Schema);
    Logger.logInfo(LogCategory.PCF, "Completed Domain Schema Update...");

    Logger.logInfo(LogCategory.PCF, "Started Dynamic Schema Update...");
    await this.enterChannel(IModel.repositoryModelId);
    await this._updateDynamicSchema();
    await this.persistChanges("Dynamic Schema Update", ChangesType.Schema);
    Logger.logInfo(LogCategory.PCF, "Completed Dynamic Schema Update.");

    Logger.logInfo(LogCategory.PCF, "Started Subject Update...");
    await this.enterChannel(IModel.repositoryModelId);
    await this._updateSubject();
    await this.persistChanges("Subject Update", ChangesType.Schema);
    Logger.logInfo(LogCategory.PCF, "Completed Subject Update.");

    Logger.logInfo(LogCategory.PCF, "Started Data Update...");
    await this.enterChannel(this.jobSubjectId);
    await this._updateLoader();
    if (this.srcState !== pcf.ItemState.Unchanged) {
      this._updateCodeSpecs();

      await this._loadIRModel();
      await this.irModel.load();
      await this._updateData();
      await this.irModel.clear();

      await this._updateDeletedElements();
      await this._updateProjectExtents();
    } else {
      Logger.logInfo(LogCategory.PCF, "Source data has not changed. Skip data update.");
    }
    await this.persistChanges("Data Update", ChangesType.Regular);
    Logger.logInfo(LogCategory.PCF, "Completed Data Update.");

    Logger.logInfo(LogCategory.PCF, "Your Connector Job has completed");
  }

  protected async _updateLoader() {
    const loader = this.tree.getLoaderNode(this.jobArgs.connection.loaderKey);
    await loader.model.update();
    const res = await loader.update();
    this._srcState = res.state;
  }

  protected async _updateSubject() {
    const subjectKey = this.jobArgs.subjectKey;
    const subjectNode = this.tree.getSubjectNode(subjectKey);
    const res = await subjectNode.update();
    this._jobSubjectId = res.entityId;
  }

  protected async _updateDomainSchema(): Promise<any> {
    const { domainSchemaPaths } = this.config;
    if (domainSchemaPaths.length > 0)
      await this.db.importSchemas(this.reqContext, domainSchemaPaths);
  }

  protected async _updateDynamicSchema(): Promise<any> {
    const dmoMap = this.tree.buildDMOMap();
    const shouldGenerateSchema = dmoMap.elements.length + dmoMap.relationships.length + dmoMap.relatedElements.length > 0;
    if (shouldGenerateSchema) {
      if (!this.config.dynamicSchema)
        throw new Error("dynamic schema setting is missing to generate a dynamic schema.");
      const { schemaName, schemaAlias } = this.config.dynamicSchema;
      const domainSchemaNames = this.config.domainSchemaPaths.map((filePath: any) => path.basename(filePath, ".ecschema.xml"));
      const schemaState = await pcf.syncDynamicSchema(this.db, this.reqContext, domainSchemaNames, { schemaName, schemaAlias, dmoMap });
      Logger.logInfo(LogCategory.PCF, `Dynamic Schema State: ${pcf.ItemState[schemaState]}`);
      const generatedSchema = await pcf.tryGetSchema(this.db, schemaName);
      if (!generatedSchema)
        throw new Error("Failed to find dynamically generated schema.");
    }
  }

  protected async _loadIRModel() {
    const node = this.tree.getLoaderNode(this.jobArgs.connection.loaderKey);
    const loader = node.loader;
    this._irModel = new pcf.IRModel(loader, this.jobArgs.connection);
  }

  protected async _updateData() {
    const subjectKey = this.jobArgs.subjectKey;
    const subjectNode = this.tree.getSubjectNode(subjectKey);

    const defModels = subjectNode.models.filter((model: pcf.ModelNode) => model.subject.key === subjectKey && model.partitionClass.className === "DefinitionPartition");
    for (const model of defModels) {
      await model.update();
      for (const element of model.elements)
        await element.update();
    }

    const models = subjectNode.models.filter((model: pcf.ModelNode) => model.subject.key === subjectKey && model.partitionClass.className !== "DefinitionPartition");
    for (const model of models) {
      await model.update();
      for (const element of model.elements)
        await element.update();
    }

    for (const relationship of this.tree.relationships)
      await relationship.update();
    for (const relatedElement of this.tree.relatedElements)
      await relatedElement.update();
  }

  protected async _updateDeletedElements() {
    if (!this.jobArgs.enableDelete) {
      Logger.logWarning(LogCategory.PCF, "Element deletion is disabled. Skip deleting elements.");
      return;
    }

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

    for (const elementId of elementIds) {
      if (this.db.elements.tryGetElement(elementId))
        this.db.elements.deleteElement(elementId);
    }

    for (const elementId of defElementIds) {
      if (this.db.elements.tryGetElement(elementId))
        this.db.elements.deleteDefinitionElements([elementId]);
    }
  }

  protected async _updateProjectExtents() {
    const options: ComputeProjectExtentsOptions = {
      reportExtentsWithOutliers: false,
      reportOutliers: false,
    };
    const res = this.db.computeProjectExtents(options);
    this.db.updateProjectExtents(res.extents);
  }

  protected _updateCodeSpecs() {
    const codeSpecName = PConnector.CodeSpecName;
    if (this.db.codeSpecs.hasName(codeSpecName))
      return;
    const newCodeSpec = CodeSpec.create(this.db, codeSpecName, CodeScopeSpec.Type.Model);
    this.db.codeSpecs.insert(newCodeSpec);
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
    if (!this.db.isBriefcaseDb())
      return;
    await util.retryLoop(async () => {
      if (!(this.db as BriefcaseDb).concurrencyControl.isBulkMode)
        (this.db as BriefcaseDb).concurrencyControl.startBulkMode();
      if ((this.db as BriefcaseDb).concurrencyControl.hasPendingRequests)
        throw new Error("has pending requests");
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

  // For Nodes

  public updateElement(props: ElementProps, instance: pcf.IRInstance): pcf.UpdateResult {
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
      return { entityId: element.id, state: pcf.ItemState.New, comment: "" };
    }

    const xsa: ExternalSourceAspect = this.db.elements.getAspect(aspectId) as ExternalSourceAspect;
    const existing = (xsa.version ?? "") + (xsa.checksum ?? "");
    const current = (version ?? "") + (checksum ?? "");
    if (existing === current)
      return { entityId: element.id, state: pcf.ItemState.Unchanged, comment: "" };

    xsa.version = version;
    xsa.checksum = checksum;

    element.update();
    this.db.elements.updateAspect(xsa as ElementAspect);
    return { entityId: element.id, state: pcf.ItemState.Changed, comment: "" };
  }


  public async getSourceTargetIdPair(node: pcf.RelatedElementNode | pcf.RelationshipNode, instance: pcf.IRInstance): Promise<string[] | void> {
    if (!node.dmo.fromAttr || !node.dmo.toAttr)
      return;

    let sourceId;
    if (node.dmo.fromType === "IREntity") {
      const sourceModelId = this.modelCache[node.source.model.key];
      const sourceValue = instance.get(node.dmo.fromAttr);
      if (!sourceValue)
        return;
      const sourceCode = this.getCode(node.source.dmo.irEntity, sourceModelId, sourceValue);
      sourceId = this.db.elements.queryElementIdByCode(sourceCode);
    }

    let targetId;
    if (node.dmo.toType === "IREntity") {
      const targetModelId = this.modelCache[node.target!.model.key];
      const targetValue = instance.get(node.dmo.toAttr);
      if (!targetValue)
        return;
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
    const codeValue = `${entityKey}-${value}` as pcf.IRInstanceKey;
    return new Code({spec: this.defaultCodeSpec.id, scope: modelId, value: codeValue});
  }

  public get defaultCodeSpec(): CodeSpec {
    if (!this.db.codeSpecs.hasName(PConnector.CodeSpecName))
      throw new Error("Default CodeSpec is not in iModel");
    const codeSpec: CodeSpec = this.db.codeSpecs.getByName(PConnector.CodeSpecName);
    return codeSpec;
  }

  // For itwin-connector-framework

  public initialize(jobDefArgs: BridgeJobDefArgs) {
    if (!jobDefArgs.argsJson || !jobDefArgs.argsJson.jobArgs)
      throw new Error("BridgeJobDefArgs.argsJson.jobArgs must be defined to use pcf");
    this._jobArgs = jobDefArgs.argsJson.jobArgs;
    this.tree.validate(this.jobArgs);
  }

  public async initializeJob(): Promise<void> {}

  public async openSourceData() {
    if (!this.synchronizer)
      throw new Error("Syncrhonizer is not assigned yet");
    this._db = this.synchronizer.imodel;
  }

  public async importDomainSchema(reqContext: AuthorizedClientRequestContext) {
    this._authReqContext = reqContext;
    await this._updateDomainSchema();
  }

  public async importDynamicSchema(reqContext: AuthorizedClientRequestContext) {
    this._authReqContext = reqContext;
    await this._updateDynamicSchema();
  }

  public async importDefinitions() {
    this._updateCodeSpecs();
    this._jobSubjectId = this.jobSubject.id;
  }

  public async updateExistingData() {
    await this._updateLoader();
    if (this.srcState === pcf.ItemState.Unchanged)
      return;

    await this._loadIRModel();
    await this.irModel.load();
    await this._updateData();
    await this.irModel.clear();

    await this._updateDeletedElements();
    await this._updateProjectExtents();
  }

  public getJobSubjectName(sourcePath: string) {
    return this.jobArgs.subjectKey;
  }

  public getApplicationId() {
    return this.config.appId;
  }

  public getApplicationVersion() {
    return this.config.appVersion;
  }

  public getBridgeName() {
    return this.config.connectorName;
  }
}

