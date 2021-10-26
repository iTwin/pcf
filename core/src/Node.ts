/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { Id64String } from "@itwin/core-bentley";
import { InformationPartitionElement, Model, RepositoryLink, Subject, SubjectOwnsPartitionElements, SubjectOwnsSubjects } from "@itwin/core-backend";
import { Code, CodeSpec, ElementProps, IModel, InformationPartitionElementProps, ModelProps, RelatedElement, RelatedElementProps, RelationshipProps, RepositoryLinkProps, SubjectProps } from "@itwin/core-common";
import { JobArgs } from "./BaseApp";
import { ElementDMO, RelationshipDMO, RelatedElementDMO } from "./DMO";
import { IRInstance } from "./IRModel";
import { PConnector } from "./PConnector";
import { Loader } from "./loaders";
import { DynamicEntityMap } from "./DynamicSchema";
import * as fs from "fs";

/* 
 * Represents the Repository Model (the root of an iModel).
 */
export class RepoTree {

  public entityMap: DynamicEntityMap;
  public nodeMap: Map<string, Node>;

  constructor() {
    this.entityMap = { elements: [], relationships: [] };
    this.nodeMap = new Map<string, Node>();
  }

  public getNodes<T extends Node>(subjectKey: string): Array<T> {
    const nodes: any[] = [];
    for (const node of this.nodeMap.values()) {
      if (node instanceof SubjectNode && node.key === subjectKey)
        nodes.push(node);
      else if (node instanceof ModelNode && node.subject.key === subjectKey)
        nodes.push(node);
      else if (node instanceof LoaderNode && node.model.subject.key === subjectKey)
        nodes.push(node);
      else if (node instanceof ElementNode && node.model.subject.key === subjectKey)
        nodes.push(node);
      else if (node instanceof RelationshipNode && node.subject.key === subjectKey)
        nodes.push(node);
      else if (node instanceof RelatedElementNode && node.subject.key === subjectKey)
        nodes.push(node);
    }
    return nodes;
  }

  public insert<T extends Node>(node: T) {
    if (this.nodeMap.has(node.key))
      throw new Error(`Node with key "${node.key}" already exists. Each Node must have a unique key.`);

    this.nodeMap.set(node.key, node);

    if ((node instanceof ElementNode) && (typeof node.dmo.ecElement !== "string")) {
      this.entityMap.elements.push({ 
        props: node.dmo.ecElement,
      });
    }

    if (((node instanceof RelationshipNode) || (node instanceof RelatedElementNode)) && (typeof node.dmo.ecRelationship !== "string")) {
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
    this.find<LoaderNode>(jobArgs.connection.loaderKey, LoaderNode);
    this.find<SubjectNode>(jobArgs.subjectKey, SubjectNode);
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

export interface UpdateResult {
  entityId: Id64String;
  state: ItemState;
  comment: string;
}

export abstract class Node implements NodeProps {

  public pc: PConnector;
  public key: string;
  protected _hasUpdated: boolean = false;

  constructor(pc: PConnector, props: NodeProps) {
    this.pc = pc;
    this.key = props.key;
  }

  public get hasUpdated() {
    return this._hasUpdated;
  }

  public async update(): Promise<UpdateResult | UpdateResult[]> {
    this._hasUpdated = true;
    return this._update();
  };

  protected abstract _update(): Promise<UpdateResult | UpdateResult[]>;

  public abstract toJSON(): any;
}

export interface SubjectNodeProps extends NodeProps {}

export class SubjectNode extends Node implements SubjectNodeProps {

  public models: ModelNode[];

  constructor(pc: PConnector, props: SubjectNodeProps) {
    super(pc, props);
    this.models = [];
    this.pc.tree.insert<SubjectNode>(this);
  }

  protected async _update() {
    const res = { entityId: "", state: ItemState.Unchanged, comment: "" };
    const code = Subject.createCode(this.pc.db, IModel.rootSubjectId, this.key);
    const existingSubId = this.pc.db.elements.queryElementIdByCode(code);
    if (existingSubId) {
      const existingSub = this.pc.db.elements.getElement<Subject>(existingSubId);
      res.entityId = existingSub.id;
      res.state = ItemState.Unchanged;
      res.comment = `Use an existing subject - ${this.key}`;
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
      res.entityId = newSubId;
      res.state = ItemState.New;
      res.comment = `Inserted a new subject - ${this.key}`;
    }

    this.pc.subjectCache[this.key] = res.entityId;
    return res;
  }

  public toJSON(): any {
    return { modelNodes: this.models.map((model: ModelNode) => model.toJSON()) };
  }
}

export interface ModelNodeProps extends NodeProps {

  /*
   * References an EC Model class
   * it must have the same type as partitionClass
   */
  modelClass: typeof Model;
  
  /*
   * References an EC Partition class 
   * it must have the same type as modelClass
   */
  partitionClass: typeof InformationPartitionElement;

  /*
   * References a Subject Node defined by user
   */
  subject: SubjectNode;
}

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

  protected async _update() {
    const res = { entityId: "", state: ItemState.Unchanged, comment: "" };
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
      res.entityId = existingPartitionId;
      res.state = ItemState.Unchanged;
      res.comment = `Use an existing Model - ${this.key}`;
    } else {
      const partitionId = this.pc.db.elements.insertElement(partitionProps);
      const modelProps: ModelProps = {
        classFullName: this.modelClass.classFullName,
        modeledElement: { id: partitionId },
        name: this.key,
      };
      res.entityId = this.pc.db.models.insertModel(modelProps);
      res.state = ItemState.New;
      res.comment = `Inserted a new Model - ${this.key}`;
    }

    this.pc.modelCache[this.key] = res.entityId;
    return res;
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

  protected async _update() {
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
    const res = this.pc.updateElement(repoLinkProps, instance);
    this.pc.elementCache[instance.key] = res.entityId;
    this.pc.seenIdSet.add(res.entityId);
    return res;
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

  protected async _update() {
    const resList: UpdateResult[] = [];
    let instances = await this.pc.irModel.getEntityInstances(this.dmo.irEntity);
    if (typeof this.dmo.doSyncInstance === "function")
      instances = instances.filter(this.dmo.doSyncInstance);

    for (const instance of instances) {
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
        this.dmo.modifyProps(props, instance);

      const res = this.pc.updateElement(props, instance);
      resList.push(res);
      this.pc.elementCache[instance.key] = res.entityId;
      this.pc.seenIdSet.add(res.entityId);
      // const classRef = bk.ClassRegistry.getClass(props.classFullName, this.pc.db);
      // (classRef as any).onInsert = (args: bk.OnElementPropsArg) => console.log("hello");
      // console.log(classRef);
    }
    return resList;
  }

  public toJSON(): any {
    return { key: this.key, dmo: this.dmo, cateogoryNode: this.category ? this.category.key : "" };
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

  protected async _update() {
    const resList: UpdateResult[] = [];
    let instances = await this.pc.irModel.getRelationshipInstances(this.dmo.irEntity);
    if (typeof this.dmo.doSyncInstance === "function")
      instances = instances.filter(this.dmo.doSyncInstance);

    for (const instance of instances) {
      const pair = await this.pc.getSourceTargetIdPair(this, instance);
      if (!pair)
        continue;

      const { ecRelationship } = this.dmo;
      const classFullName = typeof ecRelationship === "string" ? ecRelationship : `${this.pc.dynamicSchemaName}:${ecRelationship.name}`;

      const { sourceId, targetId } = pair;
      const existing = this.pc.db.relationships.tryGetInstance(classFullName, { sourceId, targetId });
      if (existing) {
        resList.push({ entityId: existing.id, state: ItemState.Unchanged, comment: "" })
        continue;
      }

      const props: RelationshipProps = { sourceId, targetId, classFullName };
      if (typeof this.dmo.modifyProps === "function")
        this.dmo.modifyProps(props, instance);

      const relId = this.pc.db.relationships.insertInstance(props);
      resList.push({ entityId: relId, state: ItemState.New, comment: "" })
    }
    return resList;
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

  protected async _update() {
    const resList: UpdateResult[] = [];
    let instances = await this.pc.irModel.getRelationshipInstances(this.dmo.irEntity);
    if (typeof this.dmo.doSyncInstance === "function")
      instances = instances.filter(this.dmo.doSyncInstance);

    for (const instance of instances) {
      const pair = await this.pc.getSourceTargetIdPair(this, instance);
      if (!pair)
        continue;

      const { sourceId, targetId } = pair;
      const targetElement = this.pc.db.elements.getElement(targetId);

      const { ecRelationship } = this.dmo;
      const classFullName = typeof ecRelationship === "string" ? ecRelationship : `${this.pc.dynamicSchemaName}:${ecRelationship.name}`;
      const props: RelatedElementProps = { id: sourceId, relClassName: classFullName };

      if (typeof this.dmo.modifyProps === "function")
        this.dmo.modifyProps(props, instance);

      const relatedElement = RelatedElement.fromJSON(props);
      if (!relatedElement)
        throw new Error("Failed to create RelatedElement");

      (targetElement as any)[this.dmo.ecProperty] = relatedElement;
      targetElement.update();
      resList.push({ entityId: relatedElement.id, state: ItemState.New, comment: "" });
    }
    return resList;
  }

  public toJSON(): any {
    return { key: this.key, subjectNode: this.subject.key, dmo: this.dmo, sourceNode: this.source.key, targetNode: this.target ? this.target.key : "" };
  }
}
