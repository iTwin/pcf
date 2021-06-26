import * as bk from "@bentley/imodeljs-backend";
import * as common from "@bentley/imodeljs-common";
import { IRInstance, DMOMap, ElementDMO, PConnector, RelatedElementDMO, RelationshipDMO, validateElementDMO, validateRelatedElementDMO, validateRelationshipDMO } from "./pcf";

export interface TreeProps {
  models: ModelNode[];
  relationships: RelationshipNode[];
  relatedElements: RelatedElementNode[];
}

export class Tree implements TreeProps {

  public models: ModelNode[];
  public relationships: RelationshipNode[];
  public relatedElements: RelatedElementNode[];

  constructor() {
    this.models = [];
    this.relationships = [];
    this.relatedElements = [];
  }

  public buildDMOMap(): DMOMap {
    const map: DMOMap = {
      elements: [],
      relationships: [],
      relatedElements: [],
    };
    function build(node: Node) {
      if (node instanceof ElementNode)
        map.elements.push(node.dmo);
      else if (node instanceof RelationshipNode)
        map.relationships.push(node.dmo);
      else if (node instanceof RelatedElementNode)
        map.relatedElements.push(node.dmo);
    }
    this.walk(build);
    return map;
  }

  public walk(callback: (node: Node) => void) {
    for (const modelNode of this.models) {
      callback(modelNode);
      for (const elementNode of modelNode.elements) {
        callback(elementNode);
      }
    }
    for (const relationship of this.relationships) {
      callback(relationship);
    }
    for (const relatedElement of this.relatedElements) {
      callback(relatedElement);
    }
  }

  public toJSON(): any {
    return {
      modelNodes: this.models.map((model: ModelNode) => model.toJSON()),
      relationshipNodes: this.relationships.map((relationship: RelationshipNode) => relationship.toJSON()),
      relatedElementNodes: this.relatedElements.map((related: RelatedElementNode) => related.toJSON()),
    };
  }

  public async update() {
    await this._updateModels();
    await this._updateRelationships();
    await this._updateRelatedElements();
  }

  protected async _updateModels() {
    for (const model of this.models) {
      await model.update();
    }
  }

  protected async _updateRelationships() {
    for (const relationship of this.relationships) {
      await relationship.update();
    }
  }

  protected async _updateRelatedElements() {
    for (const relatedElement of this.relatedElements) {
      await relatedElement.update();
    }
  }
}

// BASE INTERFACE
// No > 1 subclassing

export interface NodeProps {
  key: string;
}

export abstract class Node implements NodeProps {

  public pc: PConnector;
  public key: string;
  public parent: Node;

  constructor(pc: PConnector, props: NodeProps) {
    this.pc = pc;
    this.key = props.key;
    this.parent = this;

    if (props.key in this.pc.nodeMap)
      throw new Error(`${props.key} already exists in NodeMap. Each Node must have a unique key.`);
    this.pc.nodeMap[props.key] = this;
  }

  public abstract update(): void;
  public abstract toJSON(): any;
}

// MODEL

export interface ModelNodeProps extends NodeProps {
  bisClass: typeof bk.Model;
  partitionClass: typeof bk.InformationPartitionElement;
}

export class ModelNode extends Node implements ModelNodeProps {

  public bisClass: typeof bk.Model;
  public partitionClass: typeof bk.InformationPartitionElement;
  public elements: ElementNode[];

  constructor(pc: PConnector, props: ModelNodeProps) {
    super(pc, props);
    this.bisClass = props.bisClass;
    this.partitionClass = props.partitionClass;
    this.elements = [];
    this.pc.tree.models.push(this);
  }

  public async update() {
    await this._updateModel();
    await this._updateElements();
  }

  protected async _updateModel() {
    const codeScope = this.pc.subject.id;
    const codeValue = this.key;
    const code = this.partitionClass.createCode(this.pc.db, codeScope, codeValue);

    const partitionProps: common.InformationPartitionElementProps = {
      classFullName: this.partitionClass.classFullName,
      federationGuid: this.key,
      userLabel: this.key,
      model: common.IModel.repositoryModelId,
      parent: new bk.SubjectOwnsPartitionElements(codeScope),
      code,
    };

    const existingPartitionId = this.pc.db.elements.queryElementIdByCode(code);

    let modelId;

    if (existingPartitionId) {
      modelId = existingPartitionId;
    } else {
      const partitionId = this.pc.db.elements.insertElement(partitionProps);
      const modelProps: common.ModelProps = {
        classFullName: this.bisClass.classFullName,
        modeledElement: { id: partitionId },
        name: this.key,
      };
      modelId = this.pc.db.models.insertModel(modelProps);
    }

    this.pc.modelCache[this.key] = modelId;
  }

  protected async _updateElements() {
    for (const node of this.elements) {
      await node.update();
    }
  }

  public toJSON(): any {
    const elementJSONArray = this.elements.map((element: any) => element.toJSON());
    return { key: this.key, classFullName: this.bisClass.classFullName, elementNodes: elementJSONArray };
  }
}

// ELEMENT

export interface ElementNodeProps extends NodeProps {
  dmo: ElementDMO;
  parent: ModelNode;
  category?: ElementNode;
}

export class ElementNode extends Node {

  public dmo: ElementDMO;
  public parent: ModelNode;
  public category?: ElementNode | undefined;

  constructor(pc: PConnector, props: ElementNodeProps) {
    super(pc, props);
    this.dmo = props.dmo;
    this.category = props.category;
    this.parent = props.parent;

    validateElementDMO(this.dmo);
    props.parent.elements.push(this);
  }

  public async update() {
    await this._updateElements();
  }

  protected async _updateElements() {
    const instances = this.pc.irModel.getEntityInstances(this.dmo);
    for (const instance of instances) {
      const modelId = this.pc.modelCache[this.parent.key];
      const codeSpec: common.CodeSpec = this.pc.db.codeSpecs.getByName(PConnector.CodeSpecName);
      const code = new common.Code({ spec: codeSpec.id, scope: modelId, value: instance.codeValue });

      const props: common.ElementProps = {
        code,
        federationGuid: instance.key,
        userLabel: instance.userLabel,
        model: modelId,
        classFullName: this.dmo.classFullName,
        jsonProperties: instance.data,
      };

      if (this.category && this.dmo.categoryAttr) {
        const instanceKey = IRInstance.createKey(this.category.dmo.entity, instance.get(this.dmo.categoryAttr));
        const categoryId = this.pc.elementCache[instanceKey];
        (props as any).category = categoryId;
      }

      if (typeof this.dmo.modifyProps === "function")
        this.dmo.modifyProps(props, instance);

      const { elementId } = this.pc.updateElement(props, instance);
      this.pc.elementCache[instance.key] = elementId;
      this.pc.seenIds.add(elementId);
    }
  }

  public toJSON(): any {
    return { key: this.key, dmo: this.dmo, cateogoryNode: this.category ? this.category.key : "" };
  }
}

// RELATIONSHIP

export interface RelationshipNodeProps extends NodeProps {
  dmo: RelationshipDMO;
  source: ElementNode;
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

    validateRelationshipDMO(this.dmo);
    pc.tree.relationships.push(this);
  }

  public async update() {
    await this._updateRelationships();
  }

  protected async _updateRelationships() {
    const instances = this.pc.irModel.getRelInstances(this.dmo);
    for (const instance of instances) {
      const pair = await this.pc.getSourceTargetIdPair(this, instance);
      if (!pair)
        continue;

      const [sourceId, targetId] = pair;
      const existing = this.pc.db.relationships.tryGetInstance(this.dmo.classFullName, { sourceId, targetId });
      if (existing)
        continue;

      const props: common.RelationshipProps = { sourceId, targetId, classFullName: this.dmo.classFullName };
      if (typeof this.dmo.modifyProps === "function")
        this.dmo.modifyProps(props, instance);

      this.pc.db.relationships.insertInstance(props);
    }
  }

  public toJSON(): any {
    return { key: this.key, dmo: this.dmo, sourceNode: this.source.key, targetNode: this.target ? this.target.key : "" };
  }
}

// RELATED ELEMENT

export interface RelatedElementNodeProps extends NodeProps {
  dmo: RelatedElementDMO;
  source: ElementNode;
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

    validateRelatedElementDMO(this.dmo);
    pc.tree.relatedElements.push(this);
  }

  public async update() {
    await this._updateRelatedElements();
  }

  protected async _updateRelatedElements() {
    const instances = this.pc.irModel.getRelInstances(this.dmo);
    for (const instance of instances) {
      const pair = await this.pc.getSourceTargetIdPair(this, instance);
      if (!pair)
        continue;

      const [sourceId, targetId] = pair;
      const targetElement = this.pc.db.elements.getElement(targetId);
      const props: common.RelatedElementProps = { id: sourceId, relClassName: this.dmo.classFullName };

      if (typeof this.dmo.modifyProps === "function")
        this.dmo.modifyProps(props, instance);

      const relatedElement = common.RelatedElement.fromJSON(props);
      if (!relatedElement)
        throw new Error("Failed to create RelatedElement");

      (targetElement as any)[this.dmo.relatedPropName] = relatedElement;
      targetElement.update();
    }
  }

  public toJSON(): any {
    return { key: this.key, dmo: this.dmo, sourceNode: this.source.key, targetNode: this.target ? this.target.key : "" };
  }
}

