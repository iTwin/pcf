/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { Id64String, Logger } from "@itwin/core-bentley";
import { Code, CodeScopeSpec, CodeSpec, ExternalSourceAspectProps, IModel, ElementProps } from "@itwin/core-common";
import { ChangesType } from "@bentley/imodelhub-client";
import { LogCategory } from "./LogCategory";
import * as bk from "@itwin/core-backend";
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
  protected _db?: bk.IModelDb;
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

  public async runJob(props: { db: bk.IModelDb, jobArgs: pcf.JobArgs }): Promise<void> {

    this.modelCache = {};
    this.elementCache = {};
    this.aspectCache = {};
    this.seenIdSet = new Set<Id64String>();

    this._db = props.db;

    this.tree.validate(props.jobArgs);
    this._jobArgs = props.jobArgs;

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

  protected async _updateLoader(): Promise<pcf.UpdateResult> {
    const loaderNode = this.tree.find<pcf.LoaderNode>(this.jobArgs.connection.loaderKey, pcf.LoaderNode);
    await loaderNode.model.update();
    const res = await loaderNode.update() as pcf.UpdateResult;
    Logger.logInfo(LogCategory.PCF, `Loader State = ${pcf.ItemState[res.state]}`);
    this._srcState = res.state;
    return res;
  }

  protected async _updateSubject(): Promise<pcf.UpdateResult> {
    const subjectNode = this.tree.find<pcf.SubjectNode>(this.jobArgs.subjectKey, pcf.SubjectNode);
    const res = await subjectNode.update() as pcf.UpdateResult;
    Logger.logInfo(LogCategory.PCF, `Subject State = ${pcf.ItemState[res.state]}`);
    this._jobSubjectId = res.entityId;
    return res;
  }

  protected async _updateDomainSchema(): Promise<any> {
    const { domainSchemaPaths } = this.config;
    if (domainSchemaPaths.length > 0)
      await this.db.importSchemas(domainSchemaPaths);
  }

  protected async _updateDynamicSchema(): Promise<any> {
    const { entityMap: dynamicEntityMap } = this.tree;
    const shouldGenerateSchema = dynamicEntityMap.elements.length + dynamicEntityMap.relationships.length > 0;
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
    const node = this.tree.find<pcf.LoaderNode>(this.jobArgs.connection.loaderKey, pcf.LoaderNode);
    const loader = node.loader;
    this._irModel = new pcf.IRModel(loader, this.jobArgs.connection);
  }

  protected async _updateData() {
    let n = 0;
    const nodes = this.tree.getNodes(this.jobArgs.subjectKey);
    for (const node of nodes) {
      if (!node.hasUpdated) {
        const res = await node.update();
        if (Array.isArray(res))
          n += res.filter((r: pcf.UpdateResult) => r.state !== pcf.ItemState.Unchanged).length;
        else
          n += 1;
      }
    }
    Logger.logInfo(LogCategory.PCF, `Number of updated EC Entity Instances: ${n}`);
  }

  protected async _updateDeletedElements() {
    if (!this.jobArgs.enableDelete) {
      Logger.logWarning(LogCategory.PCF, "Element deletion is disabled. Skip deleting elements.");
      return;
    }

    const ecsql = `SELECT aspect.Element.Id[elementId] FROM ${bk.ExternalSourceAspect.classFullName} aspect WHERE aspect.Kind !='DocumentWithBeGuid'`;
    const rows = await util.getRows(this.db, ecsql);

    const elementIds: Id64String[] = [];
    const defElementIds: Id64String[] = [];

    for (const row of rows) {
      const elementId = row.elementId;
      if (this.seenIdSet.has(elementId))
        continue;
      const element = this.db.elements.getElement(elementId);
      if (element instanceof bk.DefinitionElement)
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
    const options: bk.ComputeProjectExtentsOptions = {
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
    const description = `${header} - ${changeDesc}`;
    if (this.db instanceof bk.StandaloneDb || this.db instanceof bk.SnapshotDb) {
      this.db.saveChanges();
    } else if (this.db instanceof bk.BriefcaseDb) {
      // await this.db.pullChanges();
      this.db.saveChanges();
      await this.db.pushChanges({ description } as bk.PushChangesArgs);
    }
  }

  public async enterChannel(rootId: Id64String) {
    if (this.db instanceof bk.StandaloneDb || this.db instanceof bk.SnapshotDb)
      return;
    await this.db.locks.acquireExclusiveLock(rootId);
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

    const { aspectId } = bk.ExternalSourceAspect.findBySource(this.db, element.model, instance.entityKey, identifier);
    if (!aspectId) {
      element.insert();
      this.db.elements.insertAspect({
        classFullName: bk.ExternalSourceAspect.classFullName,
        element: { id: element.id },
        scope: { id: element.model },
        identifier,
        kind: instance.entityKey,
        checksum,
        version,
      } as ExternalSourceAspectProps);
      return { entityId: element.id, state: pcf.ItemState.New, comment: "" };
    }

    const xsa: bk.ExternalSourceAspect = this.db.elements.getAspect(aspectId) as bk.ExternalSourceAspect;
    const existing = (xsa.version ?? "") + (xsa.checksum ?? "");
    const current = (version ?? "") + (checksum ?? "");
    if (existing === current)
      return { entityId: element.id, state: pcf.ItemState.Unchanged, comment: "" };

    xsa.version = version;
    xsa.checksum = checksum;

    element.update();
    this.db.elements.updateAspect(xsa as bk.ElementAspect);
    return { entityId: element.id, state: pcf.ItemState.Changed, comment: "" };
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
      const res = await pcf.locateElement(this.db, instance.data[node.dmo.fromAttr]) as pcf.LocateResult;
      if (res.error) {
        Logger.logWarning(LogCategory.PCF, `Could not find the source EC entity for relationship instance = ${instance.key}: ${res.error}`);
        return undefined;
      }
      sourceId = res.elementId;
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
      const res = await pcf.locateElement(this.db, instance.data[node.dmo.toAttr]) as pcf.LocateResult;
      if (res.error) {
        Logger.logWarning(LogCategory.PCF, `Could not find the target EC entity for relationship instance = ${instance.key}: ${res.error}`);
        return undefined;
      }
      targetId = res.elementId;
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

  // For itwin-connector-framework

  /*
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
  */
}
