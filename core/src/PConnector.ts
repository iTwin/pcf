import { Id64String, Logger } from "@bentley/bentleyjs-core"; import { AuthorizedClientRequestContext } from "@bentley/itwin-client";
import { AuthorizedBackendRequestContext, BackendRequestContext, BriefcaseDb, ComputeProjectExtentsOptions, DefinitionElement, ExternalSourceAspect, IModelDb, IModelJsFs, Subject, SubjectOwnsSubjects } from "@bentley/imodeljs-backend";
import { Schema as MetaSchema } from "@bentley/ecschema-metadata";
import { Code, CodeScopeSpec, CodeSpec, IModel, SubjectProps } from "@bentley/imodeljs-common";
import { ChangesType } from "@bentley/imodelhub-client";
import { ItemState, SourceItem, Synchronizer } from "./fwk/Synchronizer";
import { LogCategory } from "./LogCategory";
import { IRInstanceCodeValue } from "./IRModel";
import { Loader, LoaderConfig } from "./loaders";
import * as utils from "./Utils";
import * as pcf from "./pcf";
import * as fs from "fs";
import * as path from "path";
import { JobArgs } from "./pcf";

export interface PConnectorConfigProps {
  appId: string;
  appVersion: string;
  connectorName: string;
  loader: LoaderConfig;
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
  // every PConnector must have a loader to access a data source
  public loader: LoaderConfig;
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
    this.loader = props.loader;
    if (props.domainSchemaPaths !== undefined)
      this.domainSchemaPaths = props.domainSchemaPaths;
    if (props.dynamicSchema !== undefined)
      this.dynamicSchema = props.dynamicSchema;
    pc.config = this;
  }
}

export abstract class PConnector {

  public static CodeSpecName: string = "IREntityKey-PrimaryKeyValue";

  public modelCache: { [modelNodeKey: string]: Id64String };
  public elementCache: { [elementNodeKey: string]: Id64String };
  public aspectCache: { [aspectNodeKey: string]: Id64String };
  public seenIds: Set<Id64String>;

  public tree: pcf.Tree;
  public nodeMap: { [nodeKey: string]: pcf.Node };
  protected _config?: PConnectorConfig;

  public dynamicSchema?: MetaSchema;

  // initialized by runJob()
  protected _db?: IModelDb;
  protected _loader?: Loader;
  protected _jobArgs?: JobArgs;
  protected _synchronizer?: Synchronizer;
  protected _subject?: Subject;
  protected _irModel?: pcf.IRModel;
  protected _authReqContext?: AuthorizedBackendRequestContext;

  constructor() {
    this.modelCache = {};
    this.elementCache = {};
    this.aspectCache = {};
    this.seenIds = new Set<Id64String>();
    this.nodeMap = {};
    this.tree = new pcf.Tree();
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

  public get loader() {
    if (!this._loader) 
      throw new Error("Loader is undefined");
    return this._loader;
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

  public get synchronizer() {
    if (!this._synchronizer) 
      throw new Error("synchronizer is not initilized");
    return this._synchronizer;
  }

  public get subject() {
    if (!this._subject) 
      throw new Error("subject is undefined. call updateJobSubject to populate its value.");
    return this._subject;
  }

  public get irModel() {
    if (!this._irModel) 
      throw new Error("irModel has not been initialized. call loadIRModel to populate its value.");
    return this._irModel;
  }

  public init(props: { db: IModelDb, jobArgs: JobArgs, authReqContext?: AuthorizedBackendRequestContext }): void {
    this.modelCache = {};
    this.elementCache = {};
    this.aspectCache = {};
    this.seenIds = new Set<Id64String>();

    this._db = props.db;
    this._jobArgs = props.jobArgs;
    this._authReqContext = props.authReqContext;
    this._loader = new props.jobArgs.loaderClass(this.jobArgs.con, this.config.loader);

    if (this.db.isBriefcaseDb()) {
      this.db.concurrencyControl.startBulkMode();
      this._synchronizer = new Synchronizer(this.db, false, this.authReqContext);
    } else {
      this._synchronizer = new Synchronizer(this.db, false);
    }
  }

  public async runJob(): Promise<void> {
    const srcState = await this._getSrcState();
    if (srcState !== ItemState.Unchanged) {
      await this._loadIRModel();
      await this._updateJobSubject();
      await this._updateDomainSchema();
      await this._updateDynamicSchema();
      await this._updateData();
      await this._updateDeletedElements();
      await this._updateProjectExtents();
    }
  }

  public async save() {
    const tree = this.tree.toJSON();
    const compressed = { tree, config: this.config };
    fs.writeFileSync(path.join(process.cwd(), "tree.json"), JSON.stringify(compressed, null, 4) , "utf-8");
  }

  protected async _getSrcState(): Promise<ItemState> {
    if (this.db.isBriefcaseDb())
      await this.enterRepoChannel();
    let srcState;
    const { con } = this.jobArgs;
    switch(con.kind) {
      case "FileConnection":
        let timestamp = Date.now();
        const stat = IModelJsFs.lstatSync(con.filepath);
        if (stat)
          timestamp = stat.mtimeMs;
        const sourceItem: SourceItem = { id: con.filepath, version: timestamp.toString() };
        const results = this.synchronizer.recordDocument(IModelDb.rootSubjectId, sourceItem);
        srcState = results.itemState;
        break;
      default:
        throw new Error(`${con.kind} is not supported yet.`);
    }
    if (srcState !== ItemState.Unchanged)
      await this.persistChanges("Repository Link Update", ChangesType.GlobalProperties);
    return srcState;
  }

  protected async _updateJobSubject() {
    const { subjectName } = this.jobArgs;
    const code = Subject.createCode(this.db, IModel.rootSubjectId, subjectName);
    const existingSubId = this.db.elements.queryElementIdByCode(code);
    if (existingSubId) {
      const existingSub = this.db.elements.tryGetElement<Subject>(existingSubId);
      if (existingSub)
        this._subject = existingSub;
      return;
    }

    if (this.db.isBriefcaseDb())
      await this.enterRepoChannel();

    const { appVersion, connectorName } = this.config;
    const jsonProperties = {
      Subject: {
        Job: {
          Properties: {
            ConnectorVersion: appVersion,
            ConnectorType: "pcf connector",
          },
          Connector: connectorName,
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
    this._subject = this.db.elements.getElement<Subject>(newSubId);

    await this.persistChanges("Inserted Connector Job Subject", ChangesType.GlobalProperties);
  }

  protected async _updateDomainSchema(): Promise<any> {
    if (this.db.isBriefcaseDb())
      await this.enterRepoChannel();

    const { domainSchemaPaths } = this.config;
    if (domainSchemaPaths.length > 0)
      await this.db.importSchemas(this.reqContext, domainSchemaPaths);

    await this.persistChanges(`Imported ${domainSchemaPaths.length} Domain Schema(s)`, ChangesType.Schema);
  }

  protected async _loadIRModel() {
    this._irModel = await pcf.IRModel.fromLoader(this.loader);
  }

  protected async _updateDynamicSchema(): Promise<any> {
    if (this.db.isBriefcaseDb())
      await this.enterRepoChannel();

    const dmoMap = this.tree.buildDMOMap();
    const shouldGenerateSchema = dmoMap.elements.length + dmoMap.relationships.length + dmoMap.relatedElements.length > 0;

    if (shouldGenerateSchema) {
      if (!this.config.dynamicSchema)
        throw new Error("dynamic schema setting is missing to generate a dynamic schema.");

      const { schemaName, schemaAlias } = this.config.dynamicSchema;
      const domainSchemaNames = this.config.domainSchemaPaths.map((filePath: any) => path.basename(filePath, ".ecschema.xml"));
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

  protected async _updateData() {
    if (this.db.isBriefcaseDb())
      await this.enterSubjectChannel();

    this._updateCodeSpecs();
    await this.tree.update();
    await this.persistChanges("Data Changes", ChangesType.Regular);
  }

  public async detectChanges() {

  }

  protected async _updateDeletedElements(): Promise<void> {
    if (!this.jobArgs.enableDelete)
      return;

    const ecsql = `SELECT aspect.Element.Id[elementId] FROM ${ExternalSourceAspect.classFullName} aspect WHERE aspect.Kind !='DocumentWithBeGuid'`;
    const rows = await utils.getRows(this.db, ecsql);

    const elementIds: Id64String[] = [];
    const defElementIds: Id64String[] = [];

    for (const row of rows) {
      const elementId = row.elementId;
      if (this.seenIds.has(elementId))
        continue;
      if (this.db.isBriefcaseDb()) {
        const elementChannelRoot = this.db.concurrencyControl.channel.getChannelOfElement(this.db.elements.getElement(elementId));
        if (elementChannelRoot.channelRoot !== this.db.concurrencyControl.channel.channelRoot)
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
      await this.enterSubjectChannel();

    const options: ComputeProjectExtentsOptions = {
      reportExtentsWithOutliers: false,
      reportOutliers: false,
    };
    const res = this.db.computeProjectExtents(options);
    this.db.updateProjectExtents(res.extents);

    await this.persistChanges("Updated Project Extents", ChangesType.Regular);
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

  protected _updateCodeSpecs() {
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
    const { revisionHeader } = this.jobArgs;
    const header = revisionHeader ? revisionHeader.substring(0, 400) : "itwin-pcf";
    const comment = `${header} - ${changeDesc}`;
    if (this.db.isBriefcaseDb()) {
      await utils.retryLoop(async () => {
        await (this.db as BriefcaseDb).concurrencyControl.request(this.authReqContext);
      });
      await utils.retryLoop(async () => {
        await (this.db as BriefcaseDb).pullAndMergeChanges(this.authReqContext);
      });
      this.db.saveChanges(comment);
      await utils.retryLoop(async () => {
        await (this.db as BriefcaseDb).pushChanges(this.authReqContext, comment, ctype);
      });
    } else {
      this.db.saveChanges(comment);
    }
  }

  public async enterSubjectChannel() {
    await utils.retryLoop(async () => {
      await PConnector.enterChannel(this.db as BriefcaseDb, this.authReqContext, this.subject.id);
    });
  }

  public async enterRepoChannel() {
    await utils.retryLoop(async () => {
      await PConnector.enterChannel(this.db as BriefcaseDb, this.authReqContext, IModelDb.repositoryModelId);
    });
  }

  public static async enterChannel(db: BriefcaseDb, authReqContext: AuthorizedClientRequestContext, rootId: Id64String) {
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
    await db.concurrencyControl.channel.lockChannelRoot(authReqContext);
  }
}

