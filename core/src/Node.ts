/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { Id64String } from "@bentley/bentleyjs-core";
import * as bk from "@bentley/imodeljs-backend";
import * as common from "@bentley/imodeljs-common";
import { JobArgs } from "./BaseApp";
import { DMOMap, ElementDMO, RelationshipDMO, RelatedElementDMO } from "./DMO";
import { IRInstance } from "./IRModel";
import { PConnector } from "./PConnector";
import * as fs from "fs";
import { Loader } from "./loaders";

/* 
 * Represents the Repository Model (the root of an iModel).
 */
export class RepoTree {

  public loaders: LoaderNode[];
  public subjects: SubjectNode[];
  public relatedElements: RelatedElementNode[];
  public relationships: RelationshipNode[];

  constructor() {
    this.loaders = [];
    this.subjects = [];
    this.relatedElements = [];
    this.relationships = [];
  }

  public validate(jobArgs: JobArgs): void {
    if (this.subjects.length === 0)
      throw new Error(`At least one subject node must be defined in your connector class.`);
    if (this.loaders.length === 0)
      throw new Error(`At least one loader must be defined in your connector class.`);
    this.getLoaderNode(jobArgs.connection.loaderKey);
    this.getSubjectNode(jobArgs.subjectKey);
  }

  public getLoaderNode(key: string) {
    const loader = this.loaders.find((loader: LoaderNode) => loader.key === key);
    if (!loader)
      throw new Error(`Loader with key "${key}" is not defined in your connector class.`);
    return loader;
  }

  public getSubjectNode(key: string) {
    const subject = this.subjects.find((node: SubjectNode) => node.key === key);
    if (!subject)
      throw new Error(`SubjectNode with key "${key}" is not defined in your connector class.`);
    return subject;
  }

  public buildDMOMap(): DMOMap {
    const map: DMOMap = {
      elements: [],
      relationships: [],
      relatedElements: [],
    };
    function build(node: Node) {
      if (node instanceof ElementNode && typeof node.dmo.ecElement !== "string")
        map.elements.push(node.dmo);
      else if (node instanceof RelationshipNode && typeof node.dmo.ecRelationship !== "string")
        map.relationships.push(node.dmo);
      else if (node instanceof RelatedElementNode && typeof node.dmo.ecRelationship !== "string")
        map.relatedElements.push(node.dmo);
    }
    this.walk(build);
    return map;
  }

  public walk(callback: (node: Node) => void) {
    for (const subject of this.subjects) {
      callback(subject);
      for (const modelNode of subject.models) {
        callback(modelNode);
        for (const elementNode of modelNode.elements) {
          callback(elementNode);
        }
      }
    }
    for (const relationship of this.relationships) {
      callback(relationship);
    }
    for (const relatedElement of this.relatedElements) {
      callback(relatedElement);
    }
  }

  public toJSON() {
    return { 
      subjectNodes: this.subjects.map((subject: SubjectNode) => subject.toJSON()),
      loaders: this.loaders.map((loader: LoaderNode) => loader.toJSON()),
      relationshipNodes: this.relationships.map((relationship: RelationshipNode) => relationship.toJSON()),
      relatedElementNodes: this.relatedElements.map((related: RelatedElementNode) => related.toJSON()),
    };
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

// No > 1 subclassing
export abstract class Node implements NodeProps {

  public pc: PConnector;
  public key: string;

  constructor(pc: PConnector, props: NodeProps) {
    this.pc = pc;
    this.key = props.key;

    if (props.key in this.pc.nodeMap)
      throw new Error(`Node with key "${props.key}" already exists. Each Node must have a unique key.`);
    this.pc.nodeMap[props.key] = this;
  }

  public abstract update(): Promise<UpdateResult | UpdateResult[]>;
  public abstract toJSON(): any;
}

export interface SubjectNodeProps extends NodeProps {}

export class SubjectNode extends Node implements SubjectNodeProps {

  public models: ModelNode[];
  public relationships: RelationshipNode[];
  public relatedElements: RelatedElementNode[];

  constructor(pc: PConnector, props: SubjectNodeProps) {
    super(pc, props);
    this.models = [];
    this.relationships = [];
    this.relatedElements = [];
    pc.tree.subjects.push(this);
  }

  public async update() {
    const res = { entityId: "", state: ItemState.Unchanged, comment: "" };
    const code = bk.Subject.createCode(this.pc.db, common.IModel.rootSubjectId, this.key);
    const existingSubId = this.pc.db.elements.queryElementIdByCode(code);
    if (existingSubId) {
      const existingSub = this.pc.db.elements.getElement<bk.Subject>(existingSubId);
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
      const subProps: common.SubjectProps = {
        classFullName: bk.Subject.classFullName,
        model: root.model,
        code,
        jsonProperties,
        parent: new bk.SubjectOwnsSubjects(root.id),
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
  modelClass: typeof bk.Model;
  
  /*
   * References an EC Partition class 
   * it must have the same type as modelClass
   */
  partitionClass: typeof bk.InformationPartitionElement;

  /*
   * References a Subject Node defined by user
   */
  subject: SubjectNode;
}

export class ModelNode extends Node implements ModelNodeProps {

  public modelClass: typeof bk.Model;
  public partitionClass: typeof bk.InformationPartitionElement;
  public elements: ElementNode[];
  public subject: SubjectNode;

  constructor(pc: PConnector, props: ModelNodeProps) {
    super(pc, props);
    this.elements = [];
    this.modelClass = props.modelClass;
    this.partitionClass = props.partitionClass;
    this.subject = props.subject;
    this.subject.models.push(this);
  }

  public async update() {
    const res = { entityId: "", state: ItemState.Unchanged, comment: "" };
    const subjectId = this.pc.jobSubjectId;
    const codeValue = this.key;
    const code = this.partitionClass.createCode(this.pc.db, subjectId, codeValue);

    const partitionProps: common.InformationPartitionElementProps = {
      classFullName: this.partitionClass.classFullName,
      federationGuid: this.key,
      userLabel: this.key,
      model: common.IModel.repositoryModelId,
      parent: new bk.SubjectOwnsPartitionElements(subjectId),
      code,
    };

    const existingPartitionId = this.pc.db.elements.queryElementIdByCode(code);

    if (existingPartitionId) {
      res.entityId = existingPartitionId;
      res.state = ItemState.Unchanged;
      res.comment = `Use an existing Model - ${this.key}`;
    } else {
      const partitionId = this.pc.db.elements.insertElement(partitionProps);
      const modelProps: common.ModelProps = {
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
    pc.tree.loaders.push(this);
  }

  public async update() {
    let res: UpdateResult;
    const con = this.pc.jobArgs.connection;
    switch(con.kind) {
      case "pcf_file_connection":
        const stats = fs.statSync(con.filepath);
        if (!stats)
          throw new Error(`DataConnection.filepath not found - ${con}`);
        const instance = new IRInstance({
          pkey: "nodeKey",
          entityKey: "DocumentWithBeGuid",
          version: stats.mtimeMs.toString(),
          data: { nodeKey: this.key, ...this.toJSON() },
        });
        const modelId = this.pc.modelCache[this.model.key];
        const code = bk.RepositoryLink.createCode(this.pc.db, modelId, this.key);
        const repoLinkProps = {
          classFullName: bk.RepositoryLink.classFullName,
          model: modelId,
          code,
          format: this.loader.format,
          userLabel: instance.userLabel,
          jsonProperties: instance.data,
        } as common.RepositoryLinkProps;
        res = this.pc.updateElement(repoLinkProps, instance);
        this.pc.elementCache[instance.key] = res.entityId;
        this.pc.seenIds.add(res.entityId);
        break;
      default:
        throw new Error(`${con.kind} is not supported yet.`);
    }
    return res;
  }

  public toJSON() {
    return { loader: this.loader.toJSON(), model: this.model.toJSON() };
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
  }

  public async update() {
    const resList: UpdateResult[] = [];
    const instances = this.pc.irModel.getEntityInstances(this.dmo);
    for (const instance of instances) {
      const modelId = this.pc.modelCache[this.model.key];
      const codeSpec: common.CodeSpec = this.pc.db.codeSpecs.getByName(PConnector.CodeSpecName);
      const code = new common.Code({ spec: codeSpec.id, scope: modelId, value: instance.codeValue });

      const { ecElement } = this.dmo;
      const classFullName = typeof ecElement === "string" ? ecElement : `${this.pc.dynamicSchemaName}:${ecElement.name}`;

      const props: common.ElementProps = {
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
      this.pc.seenIds.add(res.entityId);
    }
    return resList;
  }

  public toJSON(): any {
    return { key: this.key, dmo: this.dmo, cateogoryNode: this.category ? this.category.key : "" };
  }
}

export interface RelationshipNodeProps extends NodeProps {

  /*
   * Allows multiple EC Relationships to be populated by a single ElementNode
   * Each EC Relationship represents a link table relationship
   */
  dmo: RelationshipDMO;

  /*
   * References the source element
   */
  source: ElementNode;

  /*
   * References the target element
   * This is not defined if dmo points to an EC Entity with SearchKey
   */
  target?: ElementNode;
}

export class RelationshipNode extends Node {

  public dmo: RelationshipDMO;
  public source: ElementNode;
  public target?: ElementNode | undefined;

  constructor(pc: PConnector, props: RelationshipNodeProps) {
    super(pc, props);
    this.dmo = props.dmo;
    this.source = props.source;
    this.target = props.target;
    pc.tree.relationships.push(this);
  }

  public async update() {
    const resList: UpdateResult[] = [];
    const instances = this.pc.irModel.getRelInstances(this.dmo);
    for (const instance of instances) {
      const pair = await this.pc.getSourceTargetIdPair(this, instance);
      if (!pair)
        continue;

      const { ecRelationship } = this.dmo;
      const classFullName = typeof ecRelationship === "string" ? ecRelationship : `${this.pc.dynamicSchemaName}:${ecRelationship.name}`;

      const [sourceId, targetId] = pair;
      const existing = this.pc.db.relationships.tryGetInstance(classFullName, { sourceId, targetId });
      if (existing) {
        resList.push({ entityId: existing.id, state: ItemState.Unchanged, comment: "" })
        continue;
      }

      const props: common.RelationshipProps = { sourceId, targetId, classFullName };
      if (typeof this.dmo.modifyProps === "function")
        this.dmo.modifyProps(props, instance);

      const relId = this.pc.db.relationships.insertInstance(props);
      resList.push({ entityId: relId, state: ItemState.New, comment: "" })
    }
    return resList;
  }

  public toJSON(): any {
    return { key: this.key, dmo: this.dmo, sourceNode: this.source.key, targetNode: this.target ? this.target.key : "" };
  }
}

export interface RelatedElementNodeProps extends NodeProps {

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
   * This is not defined if dmo points to an EC Entity with SearchKey
   */
  target?: ElementNode;
}

export class RelatedElementNode extends Node {

  public dmo: RelatedElementDMO;
  public source: ElementNode;
  public target?: ElementNode | undefined;

  constructor(pc: PConnector, props: RelatedElementNodeProps) {
    super(pc, props);
    this.dmo = props.dmo;
    this.source = props.source;
    this.target = props.target;
    pc.tree.relatedElements.push(this);
  }

  public async update() {
    const resList: UpdateResult[] = [];
    const instances = this.pc.irModel.getRelInstances(this.dmo);
    for (const instance of instances) {
      const pair = await this.pc.getSourceTargetIdPair(this, instance);
      if (!pair)
        continue;

      const [sourceId, targetId] = pair;
      const targetElement = this.pc.db.elements.getElement(targetId);

      const { ecRelationship } = this.dmo;
      const classFullName = typeof ecRelationship === "string" ? ecRelationship : `${this.pc.dynamicSchemaName}:${ecRelationship.name}`;
      const props: common.RelatedElementProps = { id: sourceId, relClassName: classFullName };

      if (typeof this.dmo.modifyProps === "function")
        this.dmo.modifyProps(props, instance);

      const relatedElement = common.RelatedElement.fromJSON(props);
      if (!relatedElement)
        throw new Error("Failed to create RelatedElement");

      (targetElement as any)[this.dmo.ecProperty] = relatedElement;
      targetElement.update();
      resList.push({ entityId: relatedElement.id, state: ItemState.New, comment: "" });
    }
    return resList;
  }

  public toJSON(): any {
    return { key: this.key, dmo: this.dmo, sourceNode: this.source.key, targetNode: this.target ? this.target.key : "" };
  }
}
