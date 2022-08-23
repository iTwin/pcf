/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import * as fs from "fs";

import { Code, CodeSpec, ElementAspectProps, ElementProps, IModel, InformationPartitionElementProps, ModelProps, RelatedElement, RelatedElementProps, RelationshipProps, RepositoryLinkProps, SubjectProps } from "@itwin/core-common";
import { ElementAspectDMO, ElementDMO, ElementInSubModelDMO, RelatedElementDMO, RelationshipDMO } from "./DMO";
import { IModelDb, InformationPartitionElement, Model, RepositoryLink, Subject, SubjectOwnsPartitionElements, SubjectOwnsSubjects } from "@itwin/core-backend";

import { DynamicEntityMap } from "./DynamicSchema";
import { IRInstance } from "./IRModel";
import { Id64String } from "@itwin/core-bentley";
import { JobArgs } from "./BaseApp";
import { Loader } from "./loaders";
import { PConnector } from "./PConnector";

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
  public getNodes(subjectNodeKey: string): Node[] {
    const nodes: Node[] = [];
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
  protected _isSynced = false;

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
  }

  /*
   * Must be implemented by subclass Nodes
   */
  protected abstract _sync(): Promise<SyncResult | SyncResult[]>;

  /*
   * Serialize current Node to JSON
   */
  public abstract toJSON(): any;
}

export type SubjectNodeProps = NodeProps

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
          data: {
            nodeKey: this.key,
            mtimeMs: stats.mtimeMs.toString(),
            connection: con,
            ...this.loader.toJSON(),
          },
        });
        break;
      case "pcf_api_connection":
        instance = new IRInstance({
          pkey: "nodeKey",
          entityKey: "DocumentWithBeGuid",
          version: this.loader.version,
          data: {
            nodeKey: this.key,
            connection: con,
            ...this.loader.toJSON(),
          },
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

    if (con.kind === "pcf_api_connection")
      result.state = ItemState.Changed;

    this.pc.onSyncElement(result, instance);
    return result;
  }

  public toJSON() {
    return { loader: this.loader.toJSON() };
  }
}

export type ElementNodeProps = NodeProps & {
  /*
   * References a Category Node defined by user
   */
  category?: ElementNode,
} & ({
  /*
   * Allows multiple EC Elements to be populated by a single ElementNode
   */
  dmo: ElementDMO,

  /*
   * References a Model Node defined by user
   * All the elements populated by the dmo will be contained by this model
   */
  model: ModelNode,

  /*
   * A parent navigation property. The second type in the union is equivalent to
   * [`RelatedElementProps`](https://www.itwinjs.org/reference/core-common/entities/relatedelementprops).
   */
  parent?: ElementNode | { parent: ElementNode, relationship: string };
} | {
  /*
   * Parent is mandatory.
   */
  dmo: ElementInSubModelDMO,

  /*
   * The element is a modeled element, so it can't have a parent.
   */
  parent: ModeledElementNode;
});

/*
 * ElementNode Represents a regular Element in iModel
 *
 * It populates multiple Element instances based on DMO
 */
export class ElementNode extends Node {

  public dmo: ElementDMO | ElementInSubModelDMO;
  public model: ModelNode | ModeledElementNode;
  public category?: ElementNode;
  public parent?: ElementNode | { parent: ElementNode, relationship: string };

  constructor(pc: PConnector, props: ElementNodeProps) {
    super(pc, props);

    this.dmo = props.dmo;
    this.category = props.category;

    // Here we translate from PCF's language to iModel language. Every element has a model, and we
    // have to extract the element node's model node. Elements contained in the model of a modeled
    // element aren't really children of that element.

    if ("model" in props) {
      this.model = props.model;
      this.parent = props.parent;
    } else {
      this.model = props.parent;
    }

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

      // Locate the ECInstanceId of the model. Either we have a ModelNode, for which there is
      // exactly one model and partition in the iModel, or we have a ModeledElementNode. We use the
      // ElementNode part of the ModeledElementNode to obtain its code value, which we use to
      // identify the model in the model cache. Remember that PCF uses JavaScript identifiers to
      // relate nodes, so we always know a model will be inserted before its elements and exist in
      // the cache.

      let modelId;
      if (this.model instanceof ModeledElementNode) {
        // We know that if the model of this ElementNode is a ModeledElementNode, then the
        // parentAttr of this element must be defined in its DMO.
        const modelKey = IRInstance.createKey(this.model.dmo.irEntity, instance.get(this.dmo.parentAttr as string));
        modelId = this.pc.modelCache[modelKey];
      } else {
        modelId = this.pc.modelCache[this.model.key];
      }

      const codeSpec: CodeSpec = this.pc.db.codeSpecs.getByName(PConnector.CodeSpecName);
      const code = new Code({ spec: codeSpec.id, scope: modelId, value: instance.codeValue });

      const { ecElement } = this.dmo;
      const classFullName = typeof ecElement === "string" ? ecElement : `${this.pc.dynamicSchemaName}:${ecElement.name}`;

      const props: ElementProps & { category?: Id64String } = {
        code,
        federationGuid: instance.key,
        userLabel: instance.userLabel,
        model: modelId,
        classFullName,
        jsonProperties: instance.data,
      };

      // First hack to evade mandatory navigation properties.

      if (this.category && this.dmo.categoryAttr) {
        const instanceKey = IRInstance.createKey(this.category.dmo.irEntity, instance.get(this.dmo.categoryAttr));
        const categoryId = this.pc.elementCache[instanceKey];
        props.category = categoryId;
      }

      // Another hack to evade mandatory navigation properties, i.e., those where the source
      // multiplicity is exactly 1, and the target multiplicity (1..*). This is true of
      // bis:SubCategory's parent navigation property, except that the backend enforces this
      // constraint and not the navigation property bis:CategoryOwnsSubcategories.

      // PCF makes modeling as simple as possible. A ModelNode is an abstraction of a model and its
      // partition. A ModeledElementNode is an abstraction of a model and its modeled element. When
      // an element is made a child of a ModeledElementNode, it is placed in its model. The
      // interface is identical to parent-child modeling for elements. The model can be forgotten.

      if (this.parent && this.dmo.parentAttr) {
        const parent = "relationship" in this.parent ? this.parent.parent : this.parent;
        const parentKey = IRInstance.createKey(parent.dmo.irEntity, instance.get(this.dmo.parentAttr));
        const parentId = this.pc.elementCache[parentKey];
        props.parent = (
          "relationship" in this.parent
          ? { id: parentId, relClassName: this.parent.relationship}
          : { id: parentId }
        );
      }

      if (typeof this.dmo.modifyProps === "function") {
        await this.dmo.modifyProps(this.pc, props, instance);
      }

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

export type ModeledElementNodeProps = ElementNodeProps & {
  /*
   * The subject that contains the elements in the model.
   */
  subject: SubjectNode;

  /*
   * The kind of model this element "breaks down" into.
   */
  modelClass: typeof Model;
}

/*
 * A node that represents a modeled element in BIS.
 */
export class ModeledElementNode extends ElementNode {
  subject: SubjectNode;
  modelClass: typeof Model;

  constructor(connector: PConnector, props: ModeledElementNodeProps) {
    super(connector, props);
    this.subject = props.subject;
    this.modelClass = props.modelClass;
  }

  protected override async _sync(): Promise<SyncResult[]> {
    const changes = await super._sync();

    const instances = await this.pc.irModel.getEntityInstances(this.dmo.irEntity);
    for (const instance of instances) {
      const modeledElement = this.pc.elementCache[instance.key];
      const parentModel = this.pc.modelCache[this.model.key];

      // Currently, PCF doesn't support properties on a model, like JSON properties. If the model
      // doesn't exist, it is inserted. Otherwise it is retrieved. Models are never updated.

      const model = modelOf(this.pc.db, modeledElement);

      if (model === null) {
        const props: ModelProps = {
          classFullName: this.modelClass.classFullName,
          modeledElement: { id: modeledElement },
          parentModel,
        };

        // onSyncModeledElement is responsible only for the model part of the ModeledElementNode,
        // because onSyncElement takes care of the ElementNode part. The IR instance's key is used
        // as the key for both the connector's element cache and model cache. That way we can
        // reference both a ModeledElementNode's element and model with just an IR instance and
        // the node's DMO, which holds the IR entity.

        // These comments and sync state are currently unused, but they may be useful for debugging.
        // I'm not sure what Zach had in mind for them, but I'll try to be consistent with the
        // rest of the nodes, especially ElementNode.

        this.pc.onSyncModeledElement({
          state: ItemState.New,
          entityId: this.pc.db.models.insertModel(props),
          comment: `Inserted a new Model - ${this.key}`,
        }, instance);
      } else {
        this.pc.onSyncModeledElement({
          state: ItemState.Unchanged,
          entityId: model,
          comment: `Use an existing Model - ${this.key}`,
        }, instance);
      }
    }

    // Just return the changes from syncing the element part of the modeled element.
    return changes;
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

      if (!props.element || !props.element.id)
        throw new Error("You must attach \"props.element = { ... } as RelatedElementProps\" in ElementAspectDMO.modifyProps()");

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
        results.push({ entityId: existing.id, state: ItemState.Unchanged, comment: "" });
        continue;
      }

      const props: RelationshipProps = { sourceId, targetId, classFullName };
      if (typeof this.dmo.modifyProps === "function")
        await this.dmo.modifyProps(this.pc, props, instance);

      const relId = this.pc.db.relationships.insertInstance(props);
      results.push({ entityId: relId, state: ItemState.New, comment: "" });
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

/**
 * Return the iModel ID of the model of an element if it is modeled.
 * @param imodel
 * @param modeled An element that may be modeled.
 * @returns The iModel ID of the model.
 */
function modelOf(imodel: IModelDb, modeled: Id64String): Id64String | null
{
    const query = "select ECInstanceId from bis:Model where ModeledElement.id = ? ";

    return imodel.withPreparedStatement(query, (statement) => {
        statement.bindId(1, modeled);
        statement.step();

        // TODO: what does this do if it fails? When the resulting table is empty, for example.
        const modelId = statement.getValue(0);

        if (modelId.isNull) {
            return null;
        }

        return modelId.getId();
    });
}
