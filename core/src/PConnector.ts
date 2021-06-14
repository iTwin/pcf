import { ClientRequestContext, Id64String, Logger } from "@bentley/bentleyjs-core";
import { AuthorizedClientRequestContext } from "@bentley/itwin-client";
import { IModelDb, IModelJsFs } from "@bentley/imodeljs-backend";
import { Schema as MetaSchema } from "@bentley/ecschema-metadata";
import { AxisAlignedBox3d, Code, CodeScopeSpec, CodeSpec, Placement3d } from "@bentley/imodeljs-common";
import { IModelBridge } from "./fwk/IModelBridge";
import { BridgeJobDefArgs } from "./fwk/BridgeRunner";
import { ItemState, SourceItem, SynchronizationResults } from "./fwk/Synchronizer";
import { LogCategory } from "./LogCategory";
import { IRInstanceCodeValue } from "./IRModel";
import * as pcf from "./pcf";
import * as fs from "fs";
import * as path from "path";

export interface PConnectorConfig {
  // application ID
  appId: string;
  // application version
  appVersion: string;
  // the name of your connector (e.g. COBieConnector)
  connectorName: string;
  // EC Schema related config
  schemaConfig: SchemaConfig;
  // source data config. Define only one of them depends on your data source.
  xlsxConfig?: pcf.drivers.XLSXDriverConfig;
  jsonConfig?: pcf.drivers.JSONDriverConfig;
  sqliteConfig?: pcf.drivers.SQLiteDriverConfig;
  driver?: pcf.drivers.IDriver;
}

export interface SchemaConfig {
  // The name of your Dynamic Schema if any. (e.g. 'COBieDynamic')
  schemaName?: string;
  // The alias of your Dynamic Schema name if any. (e.g. 'COBieDynamic' => 'cd')
  schemaAlias?: string;
  // Local paths to the domain xml schemas referenced. Leave this empty if only BisCore Schema is used.
  domainSchemaPaths: string[];
}

/*
 * A subclass of iModelBridge that can be loaded by iModelBridge Framework. It must be subclassed by each custom connector.
 */
export class PConnector extends IModelBridge {

  public static CodeSpecName: string = "IREntityKey-PrimaryKeyValue";
  public static RootSubjectName = "pcf-root-subject";

  protected _driver?: pcf.drivers.IDriver;
  protected _irModel?: pcf.IRModel;
  protected _dynamicSchema?: MetaSchema;

  public srcDataState: ItemState = ItemState.New;
  public srcDataPath?: string;

  public modelCache: { [modelNodeKey: string]: Id64String };
  public elementCache: { [elementNodeKey: string]: Id64String };
  public aspectCache: { [aspectNodeKey: string]: Id64String };

  public config: PConnectorConfig;
  public tree: pcf.Tree;
  public nodeMap: { [nodeKey: string]: pcf.Node };

  constructor(config: PConnectorConfig) {
    super();

    this.config = config;

    this.modelCache = {};
    this.elementCache = {};
    this.aspectCache = {};

    this.nodeMap = {};
    this.tree = new pcf.Tree();
  }

  public get iModel() {
    if (!this.synchronizer.imodel)
      throw new Error("Loaded connector does not have iModel.");
    return this.synchronizer.imodel;
  }

  public get irModel() {
    if (!this._irModel)
      throw new Error("Loaded connector has not initialized IR Model.");
    return this._irModel;
  }

  public get driver() {
    if (!this._driver)
      throw new Error("Loaded connector has not initialized Driver.");
    return this._driver;
  }

  public async save() {
    const tree = this.tree.toJSON();
    const compressed = { tree, config: this.config };
    fs.writeFileSync(path.join(process.cwd(), "tree.json"), JSON.stringify(compressed, null, 4) , "utf-8");
  }

  public initialize(args: BridgeJobDefArgs) {}

  public async initializeJob(): Promise<void> {}

  public async openSourceData(srcDataPath: string): Promise<void> {

    this.srcDataPath = srcDataPath;

    const state = this.getSourceDataState();
    this.srcDataState = state.itemState;

    if (this.srcDataState === ItemState.Unchanged)
      return;

    this.loadDriver();
    await this.driver.open(srcDataPath);
    this._irModel = await pcf.IRModel.fromDriver(this.driver);
  }

  public async importDomainSchema(requestContext: AuthorizedClientRequestContext | ClientRequestContext): Promise<any> {
    const { domainSchemaPaths } = this.config.schemaConfig;
    if (this.srcDataState === ItemState.New && domainSchemaPaths.length > 0) {
      await this.synchronizer.imodel.importSchemas(requestContext, domainSchemaPaths);
    }
  }

  public async importDynamicSchema(requestContext: AuthorizedClientRequestContext | ClientRequestContext): Promise<any> {
    if (this.srcDataState === ItemState.Unchanged)
      return;

    const { schemaName, schemaAlias, domainSchemaPaths } = this.config.schemaConfig;

    const dmoMap = this.tree.buildDMOMap();
    const shouldGenerateSchema = dmoMap.elements.length + dmoMap.relationships.length + dmoMap.relatedElements.length > 0;

    if (shouldGenerateSchema) {
      if (!schemaName)
        throw new Error("Schema config missing schemaName to auto generate a dynamic schema");
      if (!schemaAlias)
        throw new Error("Schema config missing schemaAlias to auto generate a dynamic schema");
      if (!domainSchemaPaths)
        throw new Error("Schema config missing domainSchemaPaths to auto generate a dynamic schema");

      const domainSchemaNames = domainSchemaPaths ? domainSchemaPaths.map((filePath: any) => path.basename(filePath, ".ecschema.xml")) : [];
      await pcf.syncDynamicSchema(this.iModel, requestContext, { name: schemaName, alias: schemaAlias, domainSchemaNames, dmoMap });
      const generatedSchema = await pcf.tryGetSchema(this.iModel, schemaName);
      if (!generatedSchema)
        throw new Error("Failed to find dynamically generated schema.");
      this._dynamicSchema = generatedSchema
    }
  }

  public async importDefinitions(): Promise<any> {
    if (this.srcDataState === ItemState.Unchanged)
      return;

    this.updateCodeSpecs();
  }

  public async updateExistingData() {
    if (this.srcDataState === ItemState.Unchanged)
      return;

    await this.tree.update();
    await this.driver.close();
  }

  public getSourceDataState(): SynchronizationResults {
    let timeStamp = Date.now();

    if (!this.srcDataPath)
      throw new Error("getSourceDataState: source file has not yet been opened");

    const stat = IModelJsFs.lstatSync(this.srcDataPath);
    if (undefined !== stat)
      timeStamp = stat.mtimeMs;

    const sourceItem: SourceItem = {
      id: this.srcDataPath!,
      version: timeStamp.toString(),
    };

    const sourceDataState = this.synchronizer.recordDocument(IModelDb.rootSubjectId, sourceItem);
    if (undefined === sourceDataState)
      throw new Error(`Failed to retrieve a RepositoryLink for ${this.srcDataPath}`);

    return sourceDataState;
  }

  public async getSourceTargetIdPair(node: pcf.MultiRelatedElementNode | pcf.MultiRelationshipNode, instance: pcf.IRInstance): Promise<string[] | void> {

    let sourceId;
    if (node.dmo.fromType === "IREntity") {
      const sourceModelId = this.modelCache[node.source.parent.key];
      const sourceValue = instance.get(node.dmo.fromAttr);
      const sourceCode = this.getCode(node.source.dmo.entity, sourceModelId, sourceValue);
      sourceId = this.iModel.elements.queryElementIdByCode(sourceCode);
    }

    let targetId;
    if (node.dmo.toType === "IREntity") {
      const targetModelId = this.modelCache[node.target!.parent.key];
      const targetValue = instance.get(node.dmo.toAttr);
      const targetCode = this.getCode(node.target!.dmo.entity, targetModelId, targetValue);
      targetId = this.iModel.elements.queryElementIdByCode(targetCode);
    } else if (node.dmo.toType === "ECEntity") {
      const result = await pcf.searchElement(this.iModel, instance.data[node.dmo.toAttr]) as pcf.SearchResult;
      if (result.error) {
        Logger.logWarning(LogCategory.PCF, `Could not find source ID for instance = ${instance.key}\n${result.error}`);
        return;
      }
      targetId = result.elementId;
    }

    if (!sourceId) {
      Logger.logWarning(LogCategory.PCF, `Could not find source ID for instance = ${instance.key}`);
      return;
    }
    if (!targetId) {
      Logger.logWarning(LogCategory.PCF, `Could not find target ID for instance = ${instance.key}`);
      return;
    }

    return [sourceId, targetId];
  }

  public updateExtent(placement: Placement3d) {
    const targetPlacement: Placement3d = Placement3d.fromJSON(placement);
    const targetExtents: AxisAlignedBox3d = targetPlacement.calculateRange();
    if (!targetExtents.isNull && !this.iModel.projectExtents.containsRange(targetExtents)) {
      targetExtents.extendRange(this.iModel.projectExtents);
      this.iModel.updateProjectExtents(targetExtents);
    }
  }

  public getCode(entityName: string, modelId: Id64String, value: string): Code {
    const codeValue = `${entityName}-${value}` as IRInstanceCodeValue;
    return new Code({spec: this.defaultCodeSpec.id, scope: modelId, value: codeValue});
  }

  public updateCodeSpecs() {
    const codeSpecName = PConnector.CodeSpecName;
    if (this.iModel.codeSpecs.hasName(codeSpecName))
      return;
    const newCodeSpec = CodeSpec.create(this.iModel, codeSpecName, CodeScopeSpec.Type.Model);
    const codeSpecId = this.iModel.codeSpecs.insert(newCodeSpec);
  }

  public get defaultCodeSpec(): CodeSpec {
    if (!this.iModel.codeSpecs.hasName(PConnector.CodeSpecName))
      throw new Error("Default CodeSpec is not in iModel");
    const codeSpec: CodeSpec = this.iModel.codeSpecs.getByName(PConnector.CodeSpecName);
    return codeSpec;
  }

  public loadDriver() {
    if (this.config.jsonConfig)
      this._driver = new pcf.drivers.JSONDriver(this.config.jsonConfig);
    else if (this.config.xlsxConfig)
      this._driver = new pcf.drivers.XLSXDriver(this.config.xlsxConfig);
    else if (this.config.sqliteConfig)
      this._driver = new pcf.drivers.SQLiteDriver(this.config.sqliteConfig);
    else if (this.config.driver)
      this._driver = this.config.driver;
    else
      throw new Error("At least one data source config needs to be defined.");
  }

  public getApplicationId(): string {
    return this.config.appId;
  }

  public getApplicationVersion(): string {
    return this.config.appVersion;
  }

  public getBridgeName(): string {
    return this.config.connectorName;
  }
}
