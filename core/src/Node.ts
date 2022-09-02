/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import * as fs from "fs";

import { Code, CodeSpec, ElementAspectProps, ElementProps, IModel, InformationPartitionElementProps, ModelProps, RelatedElement, RelatedElementProps, RelationshipProps, RepositoryLinkProps, SubjectProps } from "@itwin/core-common";
import { ElementAspectDMO, ElementDMO, ElementWithParentDMO, RelatedElementDMO, RelationshipDMO } from "./DMO";
import { IModelDb, InformationPartitionElement, Model, RepositoryLink, Subject, SubjectOwnsPartitionElements, SubjectOwnsSubjects } from "@itwin/core-backend";

import { DynamicEntityMap } from "./DynamicSchema";
import { IRInstance } from "./IRModel";
import { Id64String } from "@itwin/core-bentley";
import { JobArgs } from "./BaseApp";
import { Loader } from "./loaders";
import { PConnector } from "./PConnector";

/**
 * Represents the 'repository model', the root model of an iModel. It is made of {@link Node} with
 * hierarchical structure.
 */
export class RepoTree {

  public entityMap: DynamicEntityMap;
  public nodeMap: Map<string, Node>;

  constructor() {
    this.entityMap = { entities: [], relationships: [] };
    this.nodeMap = new Map<string, Node>();
  }

  /**
   * Grabs all the {@link Node} under a {@link SubjectNode} with their ordering preserved.
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

/**
 * All {@link Node} have a unique identifier. Do not confuse this identifier with those of
 * {@link IRModel!IRInstance}, which are found in the source data. Node identifiers are used to
 * locate the `ECInstanceId` of the corresponding element in the iModel when the node corresponds to
 * exactly one element in the iModel. For example, {@link ModelNode}, which can't have a DMO.
 */
export interface NodeProps {
  /** The unique identifier of a node. */
  key: string;
}

export enum ItemState {
  Unchanged,
  New,
  Changed,
}

/**
 * The argument given to the connector's synchronization methods, like
 * {@link PConnector!PConnector#syncElement}. Besides the bundle of element properties `props`, the
 * other properties are used to determine if the element has changed in the source file, and are
 * found in external source aspects.
 *
 * @see [`bis:ExternalSourceAspect`](https://www.itwinjs.org/bis/domains/biscore.ecschema/#externalsourceaspect)
 */
export interface SyncArg {
  props: any;
  version: string;
  checksum: string;
  scope: string;
  kind: string;
  identifier: string;
}

/**
 * When the connector synchronizes an element, it gives you back the `ECInstanceId` of the element
 * in the iModel (`entityId`), how the element in the iModel compared with the
 * {@link IRModel!IRInstance} in the source data (`state`), and a description of the changes
 * (`comment`).
 */
export interface SyncResult {
  entityId: Id64String;
  state: ItemState;
  comment: string;
}

/**
 * A node represents one or multiple EC instances of an EC entity in an iModel.
 *
 * @see [The Engineering Content (EC) documentation](https://www.itwinjs.org/bis/ec).
 */
export abstract class Node implements NodeProps {

  public pc: PConnector;
  public key: string;
  protected _isSynced = false;

  constructor(pc: PConnector, props: NodeProps) {
    this.pc = pc;
    this.key = props.key;
  }

  /**
   * Returns true if this node's {@link IRModel!IRInstance} have been synchronized with the iModel.
   * In other words, if {@link Node#sync} has been called.
   */
  public get isSynced() {
    return this._isSynced;
  }

  /**
   * Synchronize a node's {@link IRModel!IRInstance} without committing. Changes eventually have to
   * be written to the iModel, for example, with
   * [`IModelDb#saveChanges`](https://www.itwinjs.org/reference/core-backend/imodels/imodeldb/savechanges).
   */
  public async sync(): Promise<SyncResult | SyncResult[]> {
    this._isSynced = true;
    return this._sync();
  };

  /**
   * Must be implemented by concrete {@link Node} types.
   */
  protected abstract _sync(): Promise<SyncResult | SyncResult[]>;

  /**
   * Convert to a JavaScript object. Useful for assertions and printing. This function was probably
   * inspired by those in the iTwin libraries, like
   * [`Entity#toJSON`](https://www.itwinjs.org/reference/core-backend/schema/entity/tojson).
   */
  public abstract toJSON(): any;
}

export interface SubjectNodeProps extends NodeProps {}

/**
 * The {@link Node} supertype for
 * [`bis:Subject`](https://www.itwinjs.org/bis/domains/biscore.ecschema/#subject)
 * elements. The parent of all subjects in PCF is the 'root subject', and subject nodes cannot be
 * nested.
 *
 * Each synchronization must specify a subject node to operate on with
 * {@link BaseApp!JobArgs#subjectNodeKey}.
 *
 * @see [The PCF wiki](https://github.com/iTwin/pcf/wiki/Nodes-in-detail#subjects) on subject nodes.
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
  /** The BIS class of the model. It must be of the same modeling perspective as its partition element. */
  modelClass: typeof Model;

  /** The BIS class of the partition. */
  partitionClass: typeof InformationPartitionElement;

  /** The subject node to contain the top-level model. */
  subject: SubjectNode;
}

/**
 * Model nodes represent exactly one model and partition in the iModel and thus cannot support DMOs.
 *
 * @see [The PCF wiki](https://github.com/iTwin/pcf/wiki/Nodes-in-detail#models) on model nodes.
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
  /** The link model to contain the loader. */
  model: ModelNode;

  /** A loader chosen by connector author. */
  loader: Loader;
}

/**
 * Loader nodes represent a repository link in the iModel and must be contained by a link model. It
 * is a special element that is responsible for persisting loader configuration in the iModel.
 *
 * @see [The PCF wiki](https://github.com/iTwin/pcf/wiki/Nodes-in-detail#loaders) on loader nodes.
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
      case "pcf_file_connection": {
        const stats = fs.statSync(con.filepath);
        if (!stats) {
          throw new Error(`FileConnection.filepath not found - ${con.filepath}`);
        }
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
      }
      case "pcf_api_connection": {
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

/**
 * The type needed to create an element node. This is a union type.
 *
 * The two object types in the union are mutually exclusive, i.e., no type is assignable to both.
 * If the element has a model node, it must not have a parent node, and vice versa.
 *
 * Required:
 * - The `dmo` property allows multiple elements to be populated by a single element node.
 * - The optional `category` property is common to each type in the union. The category contains
 *   this element if this element is geometry. See
 *   [`bis:Category`](https://www.itwinjs.org/bis/domains/biscore.ecschema/#category) for more
 *   information.
 *
 * Choose one:
 * - The `model` property is the top-level model that will contain the element. All the elements
 *   populated by the DMO will be contained by this model, except of course those in sub-models.
 * - The `parent` property is either the node that creates the parents of this element's IR
 *   instances, or a modeled element to contain this element. The second type in the union is
 *   equivalent to
 *   [`RelatedElementProps`](https://www.itwinjs.org/reference/core-common/entities/relatedelementprops).
 *
 * @see [One implementation of an exclusive union on Stack Overflow](https://stackoverflow.com/a/44425486).
 */
export type ElementNodeProps = NodeProps & {
  category?: ElementNode,
} & ({
  dmo: ElementDMO,
  model: ModelNode,
  parent?: never,
} | {
  dmo: ElementWithParentDMO,
  model?: never,
  parent: ElementNode | { parent: ElementNode, relationship: string } | ModeledElementNode
});

/**
 * Element nodes represent multiple `bis:Element` in an iModel.
 *
 * @see [The PCF wiki](https://github.com/iTwin/pcf/wiki/Nodes-in-detail#elements) on element nodes.
 */
export class ElementNode extends Node {

  public dmo: ElementDMO | ElementWithParentDMO;
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

    if (props.parent !== undefined) {
      if (props.parent instanceof ModeledElementNode) {
        this.model = props.parent;
      } else {
        const parent = "relationship" in props.parent ? props.parent.parent : props.parent;
        this.model = parent.model;
        this.parent = props.parent;
      }
    } else if (props.model !== undefined) {
      this.model = props.model;
    } else {
      throw Error("fatal: parent and model cannot both be undefined; this is a narrowing error in PCF");
    }

    if (this.model instanceof ModelNode) {
      this.model.elements.push(this);
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

      const modelId = this.modelId(instance);
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

      if (this.parent && !(this.parent instanceof ModeledElementNode)) {
        const dmo = this.dmo as ElementWithParentDMO;
        const parent = "relationship" in this.parent ? this.parent.parent : this.parent;
        const parentKey = IRInstance.createKey(parent.dmo.irEntity, instance.get(dmo.parentAttr));
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

  /**
   * Locate the ECInstanceId of the element's model. There are 3 cases:
   *
   * 1. An element with a parent. We assume that a child is in the same model as its parent,
   *    which must already exist in the iModel because PCF constrains dependencies using
   *    JavaScript identifiers, declaratively.
   * 2. An element with a ModelNode, for which there is exactly one model and partition in
   *    the iModel and the former can be identified with its node's key.
   * 3. An element with a ModeledElementNode. We use the ElementNode part of the
   *    ModeledElementNode to obtain its code value, which can identify the model in the
   *    model cache.
   */
  protected modelId(instance: IRInstance): Id64String {
      let modelId;
      if (this.parent !== undefined) { // (1)
        // Unfortunately we're only narrowing the parent property above, and so TypeScript doesn't
        // know that the DMO must be one with a mandatory 'parentAttr' property.
        const dmo = this.dmo as ElementWithParentDMO;
        const parent = "relationship" in this.parent ? this.parent.parent : this.parent;
        const parentKey = IRInstance.createKey(parent.dmo.irEntity, instance.get(dmo.parentAttr));
        const inflated = this.pc.db.elements.getElement(this.pc.elementCache[parentKey]);
        modelId = inflated.model;
      } else if (this.model instanceof ModeledElementNode) { // (3)
        const dmo = this.dmo as ElementWithParentDMO;
        const modelKey = IRInstance.createKey(this.model.dmo.irEntity, instance.get(dmo.parentAttr));
        modelId = this.pc.modelCache[modelKey];
      } else { // (2)
        modelId = this.pc.modelCache[this.model.key];
      }

      return modelId;
  }

  public toJSON(): {
    key: ElementNode["key"],
    dmo: ElementNode["dmo"],
    categoryKey?: string
    parentKey?: string,
  } {
    const readable: ReturnType<typeof this.toJSON> = {
      key: this.key,
      dmo: this.dmo,
    };

    if (this.category) {
      readable.categoryKey = this.category.key;
    }

    if (this.parent) {
      readable.parentKey = "relationship" in this.parent ? this.parent.parent.key : this.parent.key;
    }

    return readable;
  }
}

/**
 * Required:
 * - The `subject` property is the subject that categorizes the elements in the model, i.e., the
 *   subject element from which the elements in the model descend.
 * - The `modelClass` property is the BIS class of the model that this element 'breaks down' into.
 *   It must have the same modeling perspective as its parent model, which is likely a top-level
 *   model.
 */
export type ModeledElementNodeProps = ElementNodeProps & {
  subject: SubjectNode;
  modelClass: typeof Model;
}

/**
 * A node that represents a modeled element in BIS. Just like {@link ElementNode}, its subtype, a
 * ModeledElementNode supports DMOs.
 *
 * @see [The PCF wiki](https://github.com/iTwin/pcf/wiki/Nodes-in-detail#modeled-elements) on modeled element nodes.
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
    // This super call means we're going to make two passes over the elements that we need to
    // synchronize, instead of adding their models in one pass. We have no control over the behavior
    // of the ElementNode part of a ModeledElementNode.
    const changes = await super._sync();

    const instances = await this.pc.irModel.getEntityInstances(this.dmo.irEntity);
    for (const instance of instances) {
      const modeledElement = this.pc.elementCache[instance.key];
      const parentModel = this.modelId(instance);

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

    // Just return the changes from syncing the element part of the modeled element, because models
    // can't be updated.
    return changes;
  }

  public override toJSON(): ReturnType<ElementNode["toJSON"]> & { modelClass: string } {
    const readable: ReturnType<typeof this.toJSON> = {
      ...super.toJSON(),
      modelClass: this.modelClass.className,
    };

    return readable;
  }
}

export interface ElementAspectNodeProps extends NodeProps {
  /** * Allows multiple elements aspects to be populated by a single node. */
  dmo: ElementAspectDMO;

  /** The subject from which this element aspect descends. */
  subject: SubjectNode;
}

/**
 * Element aspect nodes represent multiple `bis:ElementUniqueAspect` in an iModel.
 *
 * @see [The PCF wiki](https://github.com/iTwin/pcf/wiki/Nodes-in-detail#aspects) on element aspect nodes.
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
  /**
   * The subject node from which the element nodes being related descend. PCF cannot relate elements
   * across subjects, but it can relate elements across models in the same subject.
   */
  subject: SubjectNode;

  /**
   * Allows multiple EC relationships to be populated by a single node. Each EC relationship
   * instance is a link-table relationship in the iModel.
   */
  dmo: RelationshipDMO;

  /**
   * The source of the relationship. This is not defined (`undefined`) if the DMO points to an EC entity with a
   * {@link DMO!Locator}.
   *
   * For an example of what a 'relationship source' means in BIS, see
   * [`bis:ElementRefersToDocuments`](https://www.itwinjs.org/bis/domains/biscore.ecschema/#elementreferstodocuments).
   *
   * @see [_Relationship fundamentals_](https://www.itwinjs.org/bis/guide/fundamentals/relationship-fundamentals) by Casey Mullen.
   */
  source?: ElementNode;

  /**
   * The target of the relationship. This is not defined if the DMO points to an EC entity with a
   * {@link DMO!Locator}.
   */
  target?: ElementNode;
}

/**
 * Relationship nodes represent multiple
 * [`Relationship`](https://www.itwinjs.org/reference/core-backend/relationships/relationship) in an
 * iModel, which are like link table entries in a relational database.
 *
 * @see [The PCF wiki](https://github.com/iTwin/pcf/wiki/Nodes-in-detail#relationships) on relationship nodes.
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
  /**
   * The subject from which the element and related element descend.
   */
  subject: SubjectNode;

  /**
   * Allows multiple navigation properties to be populated by a single node. Each is a foreign key
   * in the iModel.
   */
  dmo: RelatedElementDMO;

  /**
   * References the element that does not hold the foreign key in the iModel, i.e., the element
   * that is being pointed at by the one with the foreign key.
   *
   * This is not defined if the DMO points to an EC entity with a {@link DMO!Locator}.
   */
  source: ElementNode;

  /**
   * References the element that holds the foreign key in the iModel, i.e., the element that is
   * doing the pointing.
   *
   * This is not defined if the DMO points to an EC entity with a {@link DMO!Locator}.
   */
  target?: ElementNode;
}

/**
 * Related element nodes represent multiple navigation properties in an iModel.
 *
 * @see [The PCF wiki](https://github.com/iTwin/pcf/wiki/Nodes-in-detail#navigation-properties) on navigation properties.
 * @see [_Navigation properties_](https://www.itwinjs.org/bis/guide/fundamentals/relationship-fundamentals/#navigation-properties) by Casey Muller.
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
 * @returns The `ECInstanceId` of the model.
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
