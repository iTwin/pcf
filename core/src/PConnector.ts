import { BentleyStatus, Id64String, Logger } from "@bentley/bentleyjs-core"; import { AuthorizedClientRequestContext } from "@bentley/itwin-client";
import { AuthorizedBackendRequestContext, BackendRequestContext, BriefcaseDb, ComputeProjectExtentsOptions, IModelDb, IModelJsFs, Subject, SubjectOwnsSubjects } from "@bentley/imodeljs-backend";
import { Schema as MetaSchema } from "@bentley/ecschema-metadata";
import { Code, CodeScopeSpec, CodeSpec, IModel, IModelError, SubjectProps } from "@bentley/imodeljs-common";
import { ChangesType } from "@bentley/imodelhub-client";
import { ItemState, SourceItem, SynchronizationResults, Synchronizer } from "./fwk/Synchronizer";
import { LogCategory } from "./LogCategory";
import { IRInstanceCodeValue } from "./IRModel";
import { DataConnection, Loader } from "./drivers";
import * as pcf from "./pcf";
import * as fs from "fs";
import * as path from "path";
import { JobArgs } from "./pcf";

// Be extreme cautious when editing your connector config. Mistakes could potentially corrupt your iModel.
export interface PConnectorConfig {
  // Application related config
  appConfig: {
    // application ID
    appId: string;
    // application version
    appVersion: string;
    // the name of your connector (e.g. COBieConnector)
    connectorName: string;
  };
  // EC Domain/Dynamic Schema related config
  schemaConfig: {
    // The name of your Dynamic Schema if any. (e.g. 'COBieDynamic')
    schemaName?: string;
    // The alias of your Dynamic Schema name if any. (e.g. 'COBieDynamic' => 'cd')
    schemaAlias?: string;
    // Local paths to the domain xml schemas referenced. Leave this empty if only BisCore Schema is used.
    domainSchemaPaths: string[];
  };
}

export abstract class PConnector {

  public static CodeSpecName: string = "IREntityKey-PrimaryKeyValue";

  public modelCache: { [modelNodeKey: string]: Id64String };
  public elementCache: { [elementNodeKey: string]: Id64String };
  public aspectCache: { [aspectNodeKey: string]: Id64String };

  public tree: pcf.Tree;
  public nodeMap: { [nodeKey: string]: pcf.Node };

  public dynamicSchema?: MetaSchema;

  // initialized by initJob()
  protected _db?: IModelDb;
  protected _loader?: Loader;
  protected _reqContext?: AuthorizedBackendRequestContext;
  protected _jobArgs?: JobArgs;
  protected _synchronizer?: Synchronizer;
  protected _subject?: Subject;
  protected _irModel?: pcf.IRModel;
  protected _config?: PConnectorConfig;

  constructor() {
    this.modelCache = {};
    this.elementCache = {};
    this.aspectCache = {};
    this.nodeMap = {};
    this.tree = new pcf.Tree();
  }

  public get config() {
    if (!this._config)
      throw new Error("PConnector._config should be defined in the constructor of your connector class");
    return this._config;
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

  public get reqContext() {
    if (!this._reqContext) 
      throw new Error("reqContext is undefined");
    return this._reqContext;
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

  public async runJob(props: { db: IModelDb, loader: Loader, jobArgs: JobArgs, reqContext?: AuthorizedBackendRequestContext }) {

    this._db = props.db;
    this._loader = props.loader;
    this._reqContext = props.reqContext;
    this._jobArgs = props.jobArgs;

    if (this.db.isBriefcaseDb()) {
      this.db.concurrencyControl.startBulkMode();
      this._synchronizer = new Synchronizer(this.db, false, this.reqContext);
    } else {
      this._synchronizer = new Synchronizer(this.db, false);
    }

    try {
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
    } catch(err) {
      console.log(err); // TODO Debug only
      if (this.db.isBriefcaseDb())
        await this.db.concurrencyControl.abandonResources(this.reqContext as AuthorizedBackendRequestContext);
    } finally {
      this.db.close();
    }
  }

  public async save() {
    const tree = this.tree.toJSON();
    const compressed = { tree, config: this.config };
    fs.writeFileSync(path.join(process.cwd(), "tree.json"), JSON.stringify(compressed, null, 4) , "utf-8");
  }

  protected async _getSrcState(): Promise<ItemState> {
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

    if (this.db instanceof BriefcaseDb)
      await this.enterRepoChannel();

    const { appVersion, connectorName } = this.config.appConfig;
    const jsonProperties = {
      Subject: {
        Job: {
          Properties: {
            ConnectorVersion: appVersion,
            ConnectorType: "pcf connector",
          },
          Connector: connectorName,
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
    this._subject = this.db.elements.getElement<Subject>(newSubId);

    await this.persistChanges("Inserted Connector Job Subject", ChangesType.GlobalProperties);
  }

  protected async _updateDomainSchema(): Promise<any> {
    if (this.db instanceof BriefcaseDb)
      await this.enterRepoChannel();

    const { domainSchemaPaths } = this.config.schemaConfig;
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
      const { schemaName, schemaAlias, domainSchemaPaths } = this.config.schemaConfig;

      if (!schemaName)
        throw new Error("Schema config missing schemaName to auto generate a dynamic schema");
      if (!schemaAlias)
        throw new Error("Schema config missing schemaAlias to auto generate a dynamic schema");

      const domainSchemaNames = domainSchemaPaths.map((filePath: any) => path.basename(filePath, ".ecschema.xml"));
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
    if (this.db instanceof BriefcaseDb)
      await this.enterSubjectChannel();

    this._updateCodeSpecs();
    await this.tree.update();

    await this.persistChanges("Data Changes", ChangesType.Regular);
  }

  protected async _updateDeletedElements(): Promise<void> {
    if (this.db instanceof BriefcaseDb)
      await this.enterSubjectChannel();
    this.synchronizer.detectDeletedElements();
    await this.persistChanges("Deleted Elements", ChangesType.Regular);
  }

  protected async _updateProjectExtents() {
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
    if (this.db instanceof BriefcaseDb) {
      if (!(this.reqContext instanceof AuthorizedBackendRequestContext))
        throw new Error("not signed in");
      while (true) {
        try {
          await this.db.concurrencyControl.request(this.reqContext);
          await this.db.pullAndMergeChanges(this.reqContext);
          this.db.saveChanges(comment);
          await this.db.pushChanges(this.reqContext, comment, ctype);
          break;
        } catch(err) {
          if ((err as any).status === 429) { // Too Many Request Error 
            await new Promise(resolve => setTimeout(resolve, 15 * 1000));
            Logger.logInfo(LogCategory.PCF, "Requests are sent too frequent. Sleep for 15 seconds.");
          } else {
            throw err;
          }
        }
      }
    } else {
      this.db.saveChanges(comment);
    }
  }

  public async enterSubjectChannel() {
    if (!(this.reqContext instanceof AuthorizedBackendRequestContext))
      throw new Error("not signed in");
    if (!this.subject)
      throw new Error("job subject is undefined");
    await PConnector.enterChannel(this.db as BriefcaseDb, this.reqContext, this.subject.id);
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
  }
}

