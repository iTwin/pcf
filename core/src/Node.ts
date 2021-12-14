/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { Id64String } from "@itwin/core-bentley";
import { InformationPartitionElement, Model, RepositoryLink, Subject, SubjectOwnsPartitionElements, SubjectOwnsSubjects } from "@itwin/core-backend";
import { Code, CodeSpec, ElementAspectProps, ElementProps, IModel, InformationPartitionElementProps, ModelProps, PackedFeatureTable, RelatedElement, RelatedElementProps, RelationshipProps, RepositoryLinkProps, SubjectProps } from "@itwin/core-common";
import { JobArgs } from "./BaseApp";
import { ElementDMO, RelationshipDMO, RelatedElementDMO, ElementAspectDMO } from "./DMO";
import { IRInstance } from "./IRModel";
import { PConnector } from "./PConnector";
import { Loader } from "./loaders";
import { DynamicEntityMap } from "./DynamicSchema";
import * as fs from "fs";

/* 
 * Represents the Repository Model (the root of an iModel).
 *
 * It is made of Nodes with hierarchical structure.
 */
export class RepoTree {

  public entityMap: DynamicEntityMap;
  public nodeMap: Map<string, Node>;

  constructor() {
    this.entityMap = { entities: [], relationships: [] };
    this.nodeMap = new Map<string, Node>();
  }

  /*
   * Grabs all the Nodes under a SubjectNode with their ordering preserved
   */
  public getNodes<T extends Node>(subjectNodeKey: string): Array<T> {
    const nodes: any[] = [];
    for (const node of this.nodeMap.values()) {
      if (node instanceof SubjectNode && node.key === subjectNodeKey)
        nodes.push(node);
      else if (node instanceof ModelNode && node.subject.key === subjectNodeKey)
        nodes.push(node);
      else if (node instanceof LoaderNode && node.model.subject.key === subjectNodeKey)
        nodes.push(node);
      else if (node instanceof ElementNode && node.model.subject.key === subjectNodeKey)
        nodes.push(node);
      else if (node instanceof ElementAspectNode && node.subject.key === subjectNodeKey)
        nodes.push(node);
      else if (node instanceof RelationshipNode && node.subject.key === subjectNodeKey)
        nodes.push(node);
      else if (node instanceof RelatedElementNode && node.subject.key === subjectNodeKey)
        nodes.push(node);
    }
    return nodes;
  }

  public insert<T extends Node>(node: T) {
    if (this.nodeMap.has(node.key))
      throw new Error(`Node with key "${node.key}" already exists. Each Node must have a unique key.`);

    this.nodeMap.set(node.key, node);

    if ((node instanceof ElementNode) && (typeof node.dmo.ecElement !== "string")) {
      this.entityMap.entities.push({ 
        props: node.dmo.ecElement,
      });
    } else if ((node instanceof ElementAspectNode) && (typeof node.dmo.ecElementAspect !== "string")) {
      this.entityMap.entities.push({ 
        props: node.dmo.ecElementAspect,
      });
    } else if ((node instanceof RelationshipNode) && (typeof node.dmo.ecRelationship !== "string")) {
      this.entityMap.relationships.push({ 
        props: node.dmo.ecRelationship,
      });
    } else if ((node instanceof RelatedElementNode) && (typeof node.dmo.ecRelationship !== "string")) {
      this.entityMap.relationships.push({ 
        props: node.dmo.ecRelationship,
      });
    }
  }

  public find<T extends Node>(nodeKey: string, nodeClass: typeof Node): T {
    const node = this.nodeMap.get(nodeKey);
    if (!(node instanceof nodeClass))
      throw new Error(`Node with key "${nodeKey}" is not defined in your connector class.`);
    return node as T;
  }

  public validate(jobArgs: JobArgs): void {
    this.find<LoaderNode>(jobArgs.connection.loaderNodeKey, LoaderNode);
    this.find<SubjectNode>(jobArgs.subjectNodeKey, SubjectNode);
  }
}

export interface NodeProps {

  /*
   * The unique identifier of a Node
   */
  key: string;
}

export enum ItemState {
  Unchanged,
  New,
  Changed,
}

export interface SyncArg {
  props: any;
  version: string;
  checksum: string;
  scope: string;
  kind: string;
  identifier: string;
}

export interface SyncResult {
  entityId: Id64String;
  state: ItemState;
  comment: string;
}

/*
 * Node is a wrapper for an EC Entity
 */
export abstract class Node implements NodeProps {

  public pc: PConnector;
  public key: string;
  protected _isSynced: boolean = false;

  constructor(pc: PConnector, props: NodeProps) {
    this.pc = pc;
    this.key = props.key;
  }

  /*
   * Returns true if this.sync() has been called.
   */
  public get isSynced() {
    return this._isSynced;
  }

  /*
   * Synchronize Element(s) without commiting
   */
  public async sync(): Promise<SyncResult | SyncResult[]> {
    this._isSynced = true;
    return this._sync();
  };

  /*
   * Must be implemented by subclass Nodes
   */
  protected abstract _sync(): Promise<SyncResult | SyncResult[]>;

  /*
   * Serialize current Node to JSON
   */
  public abstract toJSON(): any;
}

export interface SubjectNodeProps extends NodeProps {}

/*
 * SubjectNode represents a Subject Element (with parent Subject = root Subject) in iModel.
 *
 * Each synchronization must target a SubjectNode through JobArgs.subjectNodeKey.
 */
export class SubjectNode extends Node implements SubjectNodeProps {

  public models: ModelNode[];

  constructor(pc: PConnector, props: SubjectNodeProps) {
    super(pc, props);
    this.models = [];
    this.pc.tree.insert<SubjectNode>(this);
  }

  protected async _sync() {
    const result = { entityId: "", state: ItemState.Unchanged, comment: "" };
    const code = Subject.createCode(this.pc.db, IModel.rootSubjectId, this.key);
    const existingSubId = this.pc.db.elements.queryElementIdByCode(code);
    if (existingSubId) {
      const existingSub = this.pc.db.elements.getElement<Subject>(existingSubId);
      result.entityId = existingSub.id;
      result.state = ItemState.Unchanged;
      result.comment = `Use an existing subject - ${this.key}`;
    } else {
      const { appVersion, connectorName } = this.pc.config;
      const jsonProperties = {
        Subject: {
          Job: {
            Properties: {
              ConnectorVersion: appVersion,
              ConnectorType: "pcf-connector",
            },
            Connector: connectorName,
          }
        },
      };

      const root = this.pc.db.elements.getRootSubject();
      const subProps: SubjectProps = {
        classFullName: Subject.classFullName,
        model: root.model,
        code,
        jsonProperties,
        parent: new SubjectOwnsSubjects(root.id),
      };

      const newSubId = this.pc.db.elements.insertElement(subProps);
      result.entityId = newSubId;
      result.state = ItemState.New;
      result.comment = `Inserted a new subject - ${this.key}`;
    }

    this.pc.onSyncSubject(result, this);
    return result;
  }

  public toJSON(): any {
    return { modelNodes: this.models.map((model: ModelNode) => model.toJSON()) };
  }
}

export interface ModelNodeProps extends NodeProps {

  /*
   * References an EC Model class
   * It must have the same type as partitionClass
   */
  modelClass: typeof Model;
  
  /*
   * References an EC Partition Element class 
   * It must have the same type as modelClass
   */
  partitionClass: typeof InformationPartitionElement;

  /*
   * References a Subject Node defined in the same context
   */
  subject: SubjectNode;
}

/*
 * ModelNode represents both a Model and Partition Element in iModel.
 *
 * Elements must be contained by Models = ElementNodes must reference ModelNode
 */
export class ModelNode extends Node implements ModelNodeProps {

  public modelClass: typeof Model;
  public partitionClass: typeof InformationPartitionElement;
  public elements: Array<ElementNode | LoaderNode>;
  public subject: SubjectNode;

  constructor(pc: PConnector, props: ModelNodeProps) {
    super(pc, props);
    this.elements = [];
    this.modelClass = props.modelClass;
    this.partitionClass = props.partitionClass;
    this.subject = props.subject;
    this.subject.models.push(this);
    this.pc.tree.insert<ModelNode>(this);
  }

  protected async _sync() {
    const result = { entityId: "", state: ItemState.Unchanged, comment: "" };
    const subjectId = this.pc.jobSubjectId;
    const codeValue = this.key;
    const code = this.partitionClass.createCode(this.pc.db, subjectId, codeValue);

    const partitionProps: InformationPartitionElementProps = {
      classFullName: this.partitionClass.classFullName,
      federationGuid: this.key,
      userLabel: this.key,
      model: IModel.repositoryModelId,
      parent: new SubjectOwnsPartitionElements(subjectId),
      code,
    };

    const existingPartitionId = this.pc.db.elements.queryElementIdByCode(code);

    if (existingPartitionId) {
      result.entityId = existingPartitionId;
      result.state = ItemState.Unchanged;
      result.comment = `Use an existing Model - ${this.key}`;
    } else {
      const partitionId = this.pc.db.elements.insertElement(partitionProps);
      const modelProps: ModelProps = {
        classFullName: this.modelClass.classFullName,
        modeledElement: { id: partitionId },
        name: this.key,
      };
      result.entityId = this.pc.db.models.insertModel(modelProps);
      result.state = ItemState.New;
      result.comment = `Inserted a new Model - ${this.key}`;
    }

    this.pc.onSyncModel(result, this);
    return result;
  }

  public toJSON(): any {
    const elementJSONArray = this.elements.map((element: any) => element.toJSON());
    return { key: this.key, classFullName: this.modelClass.classFullName, elementNodes: elementJSONArray };
  }
}

export interface LoaderNodeProps extends NodeProps {

  /*
   * References a Model Node defined by user
   * All the elements populated by the dmo will be contained by this model
   */
  model: ModelNode;

  /*
   * A Loader chosen by user
   */
  loader: Loader;
}

/*
 * LoaderNode represents a RepositoryLink Element in iModel
 *
 * It must be contained by a LinkModel
 *
 * It is a special ElementNode that is responsible for persisting Loader configuration in iModel
 */
export class LoaderNode extends Node implements LoaderNodeProps {

  public model: ModelNode;
  public loader: Loader;

  constructor(pc: PConnector, props: LoaderNodeProps) {
    super(pc, props);
    if (props.model.modelClass.className !== "LinkModel")
      throw new Error(`LoaderNode.model.modelClass must be "LinkModel"`);
    this.model = props.model;
    this.loader = props.loader;
    this.model.elements.push(this);
    this.pc.tree.insert<LoaderNode>(this);
  }

  protected async _sync() {
    let instance: IRInstance | undefined = undefined;
    const con = this.pc.jobArgs.connection;
    switch(con.kind) {
      case "pcf_file_connection":
        const stats = fs.statSync(con.filepath);
        if (!stats)
          throw new Error(`FileConnection.filepath not found - ${con.filepath}`);
        instance = new IRInstance({
          pkey: "nodeKey",
          entityKey: "DocumentWithBeGuid",
          version: this.loader.version,
          data: { nodeKey: this.key, mtimeMs: stats.mtimeMs.toString(), ...this.loader.toJSON() },
        });
        break;
      case "pcf_api_connection":
        instance = new IRInstance({
          pkey: "nodeKey",
          entityKey: "DocumentWithBeGuid",
          version: this.loader.version,
          data: { nodeKey: this.key, ...this.loader.toJSON() },
        });
        break;
    }

    const modelId = this.pc.modelCache[this.model.key];
    const code = RepositoryLink.createCode(this.pc.db, modelId, this.key);
    const loaderProps = this.loader.toJSON();
    const repoLinkProps = {
      classFullName: RepositoryLink.classFullName,
      model: modelId,
      code,
      format: loaderProps.format,
      userLabel: instance.userLabel,
      jsonProperties: instance.data,
    } as RepositoryLinkProps;

    const result = this.pc.syncElement({
      props: repoLinkProps,
      version: instance.version,
      checksum: instance.checksum,
      scope: modelId,
      kind: instance.entityKey,
      identifier: code.value,
    });

    this.pc.onSyncElement(result, instance);
    return result;
  }

  public toJSON() {
    return { loader: this.loader.toJSON() };
  }
}

export interface ElementNodeProps extends NodeProps {

  /*
   * Allows multiple EC Elements to be populated by a single ElementNode
   */
  dmo: ElementDMO;

  /*
   * References a Model Node defined by user
   * All the elements populated by the dmo will be contained by this model
   */
  model: ModelNode;

  /*
   * References a Category Node defined by user
   */
  category?: ElementNode;
}

/*
 * ElementNode Represents a regular Element in iModel
 *
 * It populates multiple Element instances based on DMO
 */
export class ElementNode extends Node implements ElementNodeProps {

  public dmo: ElementDMO;
  public model: ModelNode;
  public category?: ElementNode | undefined;

  constructor(pc: PConnector, props: ElementNodeProps) {
    super(pc, props);
    this.dmo = props.dmo;
    this.category = props.category;
    this.model = props.model;
    this.model.elements.push(this);
    this.pc.tree.insert<ElementNode>(this);
  }

  protected async _sync() {
    const results: SyncResult[] = [];
    const instances = await this.pc.irModel.getEntityInstances(this.dmo.irEntity);

    for (const instance of instances) {
      if (typeof this.dmo.doSyncInstance === "function") {
        const doSyncInstance = await this.dmo.doSyncInstance(instance);
        if (!doSyncInstance)
          continue;
      }

      const modelId = this.pc.modelCache[this.model.key];
      const codeSpec: CodeSpec = this.pc.db.codeSpecs.getByName(PConnector.CodeSpecName);
      const code = new Code({ spec: codeSpec.id, scope: modelId, value: instance.codeValue });

      const { ecElement } = this.dmo;
      const classFullName = typeof ecElement === "string" ? ecElement : `${this.pc.dynamicSchemaName}:${ecElement.name}`;

      const props: ElementProps = {
        code,
        federationGuid: instance.key,
        userLabel: instance.userLabel,
        model: modelId,
        classFullName,
        jsonProperties: instance.data,
      };

      if (this.category && this.dmo.categoryAttr) {
        const instanceKey = IRInstance.createKey(this.category.dmo.irEntity, instance.get(this.dmo.categoryAttr));
        const categoryId = this.pc.elementCache[instanceKey];
        (props as any).category = categoryId;
      }

      if (typeof this.dmo.modifyProps === "function")
        await this.dmo.modifyProps(this.pc, props, instance);

      const result = this.pc.syncElement({
        props: props,
        version: instance.version,
        checksum: instance.checksum,
        scope: modelId,
        kind: instance.entityKey,
        identifier: code.value,
      });

      results.push(result);
      this.pc.onSyncElement(result, instance);

      // Add custom handlers (WIP)
      // const classRef = bk.ClassRegistry.getClass(props.classFullName, this.pc.db);
      // (classRef as any).onInsert = (args: bk.OnElementPropsArg) => console.log("hello");
      // console.log(classRef);
    }
    return results;
  }

  public toJSON(): any {
    return { key: this.key, dmo: this.dmo, cateogoryNode: this.category ? this.category.key : "" };
  }
}

export interface ElementAspectNodeProps extends NodeProps {

  /*
   * Allows multiple EC Elements to be populated by a single ElementNode
   */
  dmo: ElementAspectDMO;

  /*
   * References a Subject Node defined in the same context
   */
  subject: SubjectNode;
}

/*
 * ElementAspectNode Represents a regular ElementAspect in iModel
 *
 * It populates multiple ElementAspect instances based on DMO
 */
export class ElementAspectNode extends Node implements ElementAspectNodeProps {

  public dmo: ElementAspectDMO;
  public subject: SubjectNode;

  constructor(pc: PConnector, props: ElementAspectNodeProps) {
    super(pc, props);
    this.dmo = props.dmo;
    this.subject = props.subject;
    this.pc.tree.insert<ElementAspectNode>(this);
  }

  protected async _sync() {
    const results: SyncResult[] = [];
    const instances = await this.pc.irModel.getEntityInstances(this.dmo.irEntity);

    for (const instance of instances) {
      if (typeof this.dmo.doSyncInstance === "function") {
        const doSyncInstance = await this.dmo.doSyncInstance(instance);
        if (!doSyncInstance)
          continue;
      }

      const { ecElementAspect } = this.dmo;
      const classFullName = typeof ecElementAspect === "string" ? ecElementAspect : `${this.pc.dynamicSchemaName}:${ecElementAspect.name}`;

      const props: ElementAspectProps = {
        element: { id: "" },
        classFullName,
      };

      if (typeof this.dmo.modifyProps === "function")
        await this.dmo.modifyProps(this.pc, props, instance);

      const result = this.pc.syncElementUniqueAspect({
        props: props,
        version: instance.version,
        checksum: instance.checksum,
        scope: this.pc.jobSubjectId,
        kind: instance.entityKey,
        identifier: instance.key,
      });

      results.push(result);
      this.pc.onSyncAspect(result, instance);
    }
    return results;
  }

  public toJSON(): any {
    return { key: this.key, dmo: this.dmo };
  }
}

export interface RelationshipNodeProps extends NodeProps {

  /*
   * References a Subject Node defined by user
   */
  subject: SubjectNode;

  /*
   * Allows multiple EC Relationships to be populated by a single ElementNode
   * Each EC Relationship represents a link table relationship
   */
  dmo: RelationshipDMO;

  /*
   * References the source element
   * This is not defined if dmo points to an EC Entity with Locator
   */
  source?: ElementNode;

  /*
   * References the target element
   * This is not defined if dmo points to an EC Entity with Locator
   */
  target?: ElementNode;
}

/*
 * RelationshipNode Represents a regular Relationship in iModel
 * (Relationships are like link tables in a relational database)
 *
 * It populates multiple Relationship instances based on RelationshipDMO
 */
export class RelationshipNode extends Node {

  public subject: SubjectNode;
  public dmo: RelationshipDMO;
  public source?: ElementNode;
  public target?: ElementNode;

  constructor(pc: PConnector, props: RelationshipNodeProps) {
    super(pc, props);
    this.subject = props.subject;
    this.dmo = props.dmo;
    if (props.source)
      this.source = props.source;
    if (props.target)
      this.target = props.target;

    this.pc.tree.insert<RelationshipNode>(this);
  }

  protected async _sync() {
    const results: SyncResult[] = [];
    const instances = await this.pc.irModel.getRelationshipInstances(this.dmo.irEntity);

    for (const instance of instances) {
      if (typeof this.dmo.doSyncInstance === "function") {
        const doSyncInstance = await this.dmo.doSyncInstance(instance);
        if (!doSyncInstance)
          continue;
      }

      const pair = await this.pc.getSourceTargetIdPair(this, instance);
      if (!pair)
        continue;

      const { ecRelationship } = this.dmo;
      const classFullName = typeof ecRelationship === "string" ? ecRelationship : `${this.pc.dynamicSchemaName}:${ecRelationship.name}`;

      const { sourceId, targetId } = pair;
      const existing = this.pc.db.relationships.tryGetInstance(classFullName, { sourceId, targetId });
      if (existing) {
        results.push({ entityId: existing.id, state: ItemState.Unchanged, comment: "" })
        continue;
      }

      const props: RelationshipProps = { sourceId, targetId, classFullName };
      if (typeof this.dmo.modifyProps === "function")
        await this.dmo.modifyProps(this.pc, props, instance);

      const relId = this.pc.db.relationships.insertInstance(props);
      results.push({ entityId: relId, state: ItemState.New, comment: "" })
    }
    return results;
  }

  public toJSON(): any {
    return { key: this.key, subjectNode: this.subject.key, dmo: this.dmo, sourceNode: this.source ? this.source.key : "", targetNode: this.target ? this.target.key : "" };
  }
}

export interface RelatedElementNodeProps extends NodeProps {

  /*
   * References a Subject Node defined by user
   */
  subject: SubjectNode;

  /*
   * Allows multiple EC Related Element to be populated by a single ElementNode
   * Each Related Element represents a foreign key relationship
   */
  dmo: RelatedElementDMO;

  /*
   * References the source element in the relationship
   */
  source: ElementNode;
  
  /*
   * References the target element in the relationship
   * This is not defined if dmo points to an EC Entity with Locator
   */
  target?: ElementNode;
}

/*
 * RelatedElementNode Represents a regular RelatedElement in iModel
 * (Relationships are foreign keys in a relational database)
 *
 * It populates multiple RelatedElement instances based on RelatedElementDMO
 */
export class RelatedElementNode extends Node {

  public subject: SubjectNode;
  public dmo: RelatedElementDMO;
  public source: ElementNode;
  public target?: ElementNode;

  constructor(pc: PConnector, props: RelatedElementNodeProps) {
    super(pc, props);
    this.subject = props.subject;
    this.dmo = props.dmo;
    this.source = props.source;
    if (props.target)
      this.target = props.target;
    this.pc.tree.insert<RelatedElementNode>(this);
  }

  protected async _sync() {
    const results: SyncResult[] = [];
    const instances = await this.pc.irModel.getRelationshipInstances(this.dmo.irEntity);

    for (const instance of instances) {
      if (typeof this.dmo.doSyncInstance === "function") {
        const doSyncInstance = await this.dmo.doSyncInstance(instance);
        if (!doSyncInstance)
          continue;
      }

      const pair = await this.pc.getSourceTargetIdPair(this, instance);
      if (!pair)
        continue;

      const { sourceId, targetId } = pair;
      const targetElement = this.pc.db.elements.getElement(targetId);

      const { ecRelationship } = this.dmo;
      const classFullName = typeof ecRelationship === "string" ? ecRelationship : `${this.pc.dynamicSchemaName}:${ecRelationship.name}`;
      const props: RelatedElementProps = { id: sourceId, relClassName: classFullName };

      if (typeof this.dmo.modifyProps === "function")
        await this.dmo.modifyProps(this.pc, props, instance);

      const relatedElement = RelatedElement.fromJSON(props);
      if (!relatedElement)
        throw new Error("Failed to create RelatedElement");

      (targetElement as any)[this.dmo.ecProperty] = relatedElement;
      targetElement.update();
      results.push({ entityId: relatedElement.id, state: ItemState.New, comment: "" });
    }
    return results;
  }

  public toJSON(): any {
    return { key: this.key, subjectNode: this.subject.key, dmo: this.dmo, sourceNode: this.source.key, targetNode: this.target ? this.target.key : "" };
  }
}
