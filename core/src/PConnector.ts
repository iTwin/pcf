import { Id64String, Logger } from "@bentley/bentleyjs-core";
import { AuthorizedClientRequestContext } from "@bentley/itwin-client";
import { AuthorizedBackendRequestContext, BackendRequestContext, BriefcaseDb, ComputeProjectExtentsOptions, IModelDb, IModelJsFs, Subject, SubjectOwnsSubjects } from "@bentley/imodeljs-backend";
import { Schema as MetaSchema } from "@bentley/ecschema-metadata";
import { AxisAlignedBox3d, Code, CodeScopeSpec, CodeSpec, IModel, Placement3d, SubjectProps } from "@bentley/imodeljs-common";
import { ItemState, SourceItem, SynchronizationResults, Synchronizer } from "./fwk/Synchronizer";
import { LogCategory } from "./LogCategory";
import { IRInstanceCodeValue } from "./IRModel";
import * as pcf from "./pcf";
import * as fs from "fs";
import * as path from "path";
import { ChangesType } from "@bentley/imodelhub-client";

export interface PConnectorConfig {
  // application ID
  appId: string;
  // application version
  appVersion: string;
  // the name of your connector (e.g. COBieConnector)
  connectorName: string;
  // EC Schema related config
  schemaConfig: SchemaConfig;
  // loader specific for your data source
  loader: pcf.drivers.Loader;
}

export interface SchemaConfig {
  // The name of your Dynamic Schema if any. (e.g. 'COBieDynamic')
  schemaName?: string;
  // The alias of your Dynamic Schema name if any. (e.g. 'COBieDynamic' => 'cd')
  schemaAlias?: string;
  // Local paths to the domain xml schemas referenced. Leave this empty if only BisCore Schema is used.
  domainSchemaPaths: string[];
}

export class PConnector {

  public static CodeSpecName: string = "IREntityKey-PrimaryKeyValue";

  public loader?: pcf.drivers.Loader;
  public revisionHeader?: string;
  public jobSubject?: Subject;
  public srcDataPath?: string;
  public synchronizer?: Synchronizer;
  public reqContext: AuthorizedBackendRequestContext | BackendRequestContext;

  public modelCache: { [modelNodeKey: string]: Id64String };
  public elementCache: { [elementNodeKey: string]: Id64String };
  public aspectCache: { [aspectNodeKey: string]: Id64String };

  public config: PConnectorConfig;
  public tree: pcf.Tree;
  public nodeMap: { [nodeKey: string]: pcf.Node };

  public irModel?: pcf.IRModel;
  public dynamicSchema?: MetaSchema;

  constructor(config: PConnectorConfig) {
    this.config = config;
    this.modelCache = {};
    this.elementCache = {};
    this.aspectCache = {};
    this.nodeMap = {};
    this.tree = new pcf.Tree();
    this.reqContext = new BackendRequestContext();
  }

  public get db() {
    if (!this.synchronizer)
      throw new Error("Loaded connector does not have synchronizer.");
    if (!this.synchronizer.imodel)
      throw new Error("Loaded connector does not have iModel.");
    return this.synchronizer.imodel;
  }

  public async save() {
    const tree = this.tree.toJSON();
    const compressed = { tree, config: this.config };
    fs.writeFileSync(path.join(process.cwd(), "tree.json"), JSON.stringify(compressed, null, 4) , "utf-8");
  }

  public async loadIRModel() {
    if (!this.loader)
      throw new Error("loader is undefined");
    this.irModel = await pcf.IRModel.fromLoader(this.loader);
  }

  public async updateDomainSchema(): Promise<any> {
    if (this.db instanceof BriefcaseDb)
      await this.enterRepoChannel();

    const { domainSchemaPaths } = this.config.schemaConfig;
    if (domainSchemaPaths.length > 0)
      await this.synchronizer!.imodel.importSchemas(this.reqContext, domainSchemaPaths);

    await this.persistChanges(`Imported ${domainSchemaPaths.length} Domain Schema(s)`, ChangesType.Schema);
  }

  public async updateDynamicSchema(): Promise<any> {
    if (this.db instanceof BriefcaseDb)
      await this.enterRepoChannel();

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
      const schemaState = await pcf.syncDynamicSchema(this.db, this.reqContext, { name: schemaName, alias: schemaAlias, domainSchemaNames, dmoMap });
      const generatedSchema = await pcf.tryGetSchema(this.db, schemaName);
      if (!generatedSchema)
        throw new Error("Failed to find dynamically generated schema.");
      this.dynamicSchema = generatedSchema

      if (schemaState === ItemState.New)
        await this.persistChanges("Added a Dynamic Schema", ChangesType.Schema);
      else if (schemaState === ItemState.Changed)
        await this.persistChanges("Updated Existing Dynamic Schema", ChangesType.Schema);
    }
  }

  public async updateData() {
    if (this.db instanceof BriefcaseDb)
      await this.enterSubjectChannel();

    this.updateCodeSpecs();
    await this.tree.update();
    this.synchronizer!.detectDeletedElements();

    await this.persistChanges("Data Changes", ChangesType.Regular);
  }

  public async updateProjectExtents() {
    if (this.db instanceof BriefcaseDb)
      await this.enterSubjectChannel();

    const options: ComputeProjectExtentsOptions = {
      reportExtentsWithOutliers: false,
      reportOutliers: false,
    };
    const res = this.db.computeProjectExtents(options);
    this.db.updateProjectExtents(res.extents);

    await this.persistChanges("Updated Project Extents", ChangesType.Regular);
  }

  public async updateJobSubject(subName: string) {
    const code = Subject.createCode(this.db, IModel.rootSubjectId, subName);
    const existingSubId = this.db.elements.queryElementIdByCode(code);
    if (existingSubId) {
      const existingSub = this.db.elements.tryGetElement<Subject>(existingSubId);
      if (existingSub)
        this.jobSubject = existingSub;
      return;
    }

    if (this.db instanceof BriefcaseDb)
      await this.enterRepoChannel();

    const jsonProperties = {
      Subject: {
        Job: {
          Properties: {
            ConnectorVersion: this.config.appVersion,
            ConnectorType: "pcf connector",
          },
          Connector: this.config.connectorName,
          Comments: "",
        }
      },
    }

    const root = this.db.elements.getRootSubject();
    const subProps: SubjectProps = {
      classFullName: Subject.classFullName,
      model: root.model,
      code,
      jsonProperties,
      parent: new SubjectOwnsSubjects(root.id),
    };

    const newSubId = this.db.elements.insertElement(subProps);
    this.jobSubject = this.db.elements.getElement<Subject>(newSubId);

    await this.persistChanges("Inserted Connector Job Subject", ChangesType.GlobalProperties);
  }

  public getSrcDataState(): SynchronizationResults {
    if (!this.srcDataPath)
      throw new Error("Source file has not yet been opened");

    let timeStamp = Date.now();
    const stat = IModelJsFs.lstatSync(this.srcDataPath);
    if (stat)
      timeStamp = stat.mtimeMs;

    const sourceItem: SourceItem = { id: this.srcDataPath, version: timeStamp.toString() };
    const srcDataState = this.synchronizer!.recordDocument(IModelDb.rootSubjectId, sourceItem);
    if (!srcDataState)
      throw new Error(`Failed to retrieve a RepositoryLink for ${this.srcDataPath}`);

    return srcDataState;
  }

  public async getSourceTargetIdPair(node: pcf.MultiRelatedElementNode | pcf.MultiRelationshipNode, instance: pcf.IRInstance): Promise<string[] | void> {

    let sourceId;
    if (node.dmo.fromType === "IREntity") {
      const sourceModelId = this.modelCache[node.source.parent.key];
      const sourceValue = instance.get(node.dmo.fromAttr);
      const sourceCode = this.getCode(node.source.dmo.entity, sourceModelId, sourceValue);
      sourceId = this.db.elements.queryElementIdByCode(sourceCode);
    }

    let targetId;
    if (node.dmo.toType === "IREntity") {
      const targetModelId = this.modelCache[node.target!.parent.key];
      const targetValue = instance.get(node.dmo.toAttr);
      const targetCode = this.getCode(node.target!.dmo.entity, targetModelId, targetValue);
      targetId = this.db.elements.queryElementIdByCode(targetCode);
    } else if (node.dmo.toType === "ECEntity") {
      const result = await pcf.searchElement(this.db, instance.data[node.dmo.toAttr]) as pcf.SearchResult;
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

  public getCode(entityName: string, modelId: Id64String, value: string): Code {
    const codeValue = `${entityName}-${value}` as IRInstanceCodeValue;
    return new Code({spec: this.defaultCodeSpec.id, scope: modelId, value: codeValue});
  }

  public updateCodeSpecs() {
    const codeSpecName = PConnector.CodeSpecName;
    if (this.db.codeSpecs.hasName(codeSpecName))
      return;
    const newCodeSpec = CodeSpec.create(this.db, codeSpecName, CodeScopeSpec.Type.Model);
    const codeSpecId = this.db.codeSpecs.insert(newCodeSpec);
  }

  public get defaultCodeSpec(): CodeSpec {
    if (!this.db.codeSpecs.hasName(PConnector.CodeSpecName))
      throw new Error("Default CodeSpec is not in iModel");
    const codeSpec: CodeSpec = this.db.codeSpecs.getByName(PConnector.CodeSpecName);
    return codeSpec;
  }

  public async persistChanges(changeDesc: string, ctype: ChangesType) {
    const header = this.revisionHeader ? this.revisionHeader.substring(0, 400) : "itwin-pcf";
    const comment = `${header} - ${changeDesc}`;
    if (this.db instanceof BriefcaseDb) {
      if (!(this.reqContext instanceof AuthorizedBackendRequestContext))
        throw new Error("not signed in");
      await this.db.concurrencyControl.request(this.reqContext);
      await this.db.pullAndMergeChanges(this.reqContext);
      this.db.saveChanges(comment);
      await this.db.pushChanges(this.reqContext, comment, ctype);
    } else {
      this.db.saveChanges(comment);
    }
  }

  public async enterSubjectChannel() {
    if (!(this.reqContext instanceof AuthorizedBackendRequestContext))
      throw new Error("not signed in");
    if (!this.jobSubject)
      throw new Error("job subject is undefined");
    await PConnector.enterChannel(this.db as BriefcaseDb, this.reqContext, this.jobSubject.id);
  }

  public async enterRepoChannel() {
    if (!(this.reqContext instanceof AuthorizedBackendRequestContext))
      throw new Error("not signed in");
    await PConnector.enterChannel(this.db as BriefcaseDb, this.reqContext, IModelDb.repositoryModelId);
  }

  public static async enterChannel(db: BriefcaseDb, reqContext: AuthorizedClientRequestContext, rootId: Id64String) {
    if (db.concurrencyControl.hasPendingRequests)
      throw new Error("has pending requests");
    if (!db.concurrencyControl.isBulkMode)
      throw new Error("not in bulk mode");
    if (db.concurrencyControl.locks.hasSchemaLock)
      throw new Error("has schema lock");
    if (db.concurrencyControl.locks.hasCodeSpecsLock)
      throw new Error("has code spec lock");
    if (db.concurrencyControl.channel.isChannelRootLocked)
      throw new Error("holds lock on current channel root. it must be released before entering a new channel.");
    db.concurrencyControl.channel.channelRoot = rootId;
    await db.concurrencyControl.channel.lockChannelRoot(reqContext);
    if (!db.concurrencyControl.channel.isChannelRootLocked)
      throw new Error("channel root not locked");
  }
}

