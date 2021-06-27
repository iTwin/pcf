import { Id64String } from "@bentley/bentleyjs-core";
import * as bk from "@bentley/imodeljs-backend";
import * as common from "@bentley/imodeljs-common";
import { IRInstance, DMOMap, ElementDMO, PConnector, RelatedElementDMO, RelationshipDMO, validateElementDMO, validateRelatedElementDMO, validateRelationshipDMO, Loader, JobArgs, ItemState } from "./pcf";

export class RepoTree {
  public loaders: Loader[];
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
    this.getLoader(jobArgs.connection.loaderKey);
    this.getSubjectNode(jobArgs.subjectKey);
  }

  public getLoader(key: string) {
    const loader = this.loaders.find((loader: Loader) => loader.key === key);
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
      loaders: this.loaders.map((loader: Loader) => loader.toJSON()),
      relationshipNodes: this.relationships.map((relationship: RelationshipNode) => relationship.toJSON()),
      relatedElementNodes: this.relatedElements.map((related: RelatedElementNode) => related.toJSON()),
    };
  }
}

// BASE INTERFACE
// No > 1 subclassing

export interface NodeProps {
  key: string;
}

export interface UpdateResult {
  entityId: Id64String;
  state: ItemState;
}

export abstract class Node implements NodeProps {

  public pc: PConnector;
  public key: string;
  public parentNode: Node;

  constructor(pc: PConnector, props: NodeProps) {
    this.pc = pc;
    this.key = props.key;
    this.parentNode = this;

    if (props.key in this.pc.nodeMap)
      throw new Error(`${props.key} already exists in NodeMap. Each Node must have a unique key.`);
    this.pc.nodeMap[props.key] = this;
  }

  public abstract update(): Promise<UpdateResult | UpdateResult[]>;
  public abstract toJSON(): any;
}

// SUBJECT

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

  public toJSON(): any {
    return { modelNodes: this.models.map((model: ModelNode) => model.toJSON()) };
  }

  public async update() {
    const subjectName = this.key;
    const code = bk.Subject.createCode(this.pc.db, common.IModel.rootSubjectId, subjectName);
    const existingSubId = this.pc.db.elements.queryElementIdByCode(code);
    if (existingSubId) {
      const existingSub = this.pc.db.elements.getElement<bk.Subject>(existingSubId);
      this.pc.jobSubject = existingSub;
      return { entityId: existingSub.id, state: ItemState.Unchanged};
    }

    const { appVersion, connectorName } = this.pc.config;
    const jsonProperties = { appVersion, connectorName };

    const root = this.pc.db.elements.getRootSubject();
    const subProps: common.SubjectProps = {
      classFullName: bk.Subject.classFullName,
      model: root.model,
      code,
      jsonProperties,
      parent: new bk.SubjectOwnsSubjects(root.id),
    };

    const newSubId = this.pc.db.elements.insertElement(subProps);
    const newSub = this.pc.db.elements.getElement<bk.Subject>(newSubId);
    this.pc.jobSubject = newSub;
    return { entityId: newSub.id, state: ItemState.New };
  }
}

// MODEL

export interface ModelNodeProps extends NodeProps {
  modelClass: typeof bk.Model;
  partitionClass: typeof bk.InformationPartitionElement;
  parentNode: SubjectNode;
}

export class ModelNode extends Node implements ModelNodeProps {

  public modelClass: typeof bk.Model;
  public partitionClass: typeof bk.InformationPartitionElement;
  public elements: ElementNode[];
  public parentNode: SubjectNode;

  constructor(pc: PConnector, props: ModelNodeProps) {
    super(pc, props);
    this.modelClass = props.modelClass;
    this.partitionClass = props.partitionClass;
    this.elements = [];
    this.parentNode = props.parentNode;
    this.parentNode.models.push(this);
  }

  public async update() {
    const codeScope = this.pc.jobSubject.id;
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
    let modelState;

    if (existingPartitionId) {
      modelId = existingPartitionId;
      modelState = ItemState.Unchanged;
    } else {
      const partitionId = this.pc.db.elements.insertElement(partitionProps);
      const modelProps: common.ModelProps = {
        classFullName: this.modelClass.classFullName,
        modeledElement: { id: partitionId },
        name: this.key,
      };
      modelId = this.pc.db.models.insertModel(modelProps);
      modelState = ItemState.New;
    }

    this.pc.modelCache[this.key] = modelId;
    return { entityId: modelId, state: modelState };
  }

  public toJSON(): any {
    const elementJSONArray = this.elements.map((element: any) => element.toJSON());
    return { key: this.key, classFullName: this.modelClass.classFullName, elementNodes: elementJSONArray };
  }
}

// ELEMENT

export interface ElementNodeProps extends NodeProps {
  dmo: ElementDMO;
  parentNode: ModelNode;
  category?: ElementNode;
}

export class ElementNode extends Node {

  public dmo: ElementDMO;
  public parentNode: ModelNode;
  public category?: ElementNode | undefined;

  constructor(pc: PConnector, props: ElementNodeProps) {
    super(pc, props);
    this.dmo = props.dmo;
    this.category = props.category;
    this.parentNode = props.parentNode;

    validateElementDMO(this.dmo);
    this.parentNode.elements.push(this);
  }

  public async update() {
    const results: UpdateResult[] = [];
    const instances = this.pc.irModel.getEntityInstances(this.dmo);
    for (const instance of instances) {
      const modelId = this.pc.modelCache[this.parentNode.key];
      const codeSpec: common.CodeSpec = this.pc.db.codeSpecs.getByName(PConnector.CodeSpecName);
      const code = new common.Code({ spec: codeSpec.id, scope: modelId, value: instance.codeValue });

      const props: common.ElementProps = {
        code,
        federationGuid: instance.key,
        userLabel: instance.userLabel,
        model: modelId,
        classFullName: this.dmo.ecEntity,
        jsonProperties: instance.data,
      };

      if (this.category && this.dmo.categoryAttr) {
        const instanceKey = IRInstance.createKey(this.category.dmo.irEntity, instance.get(this.dmo.categoryAttr));
        const categoryId = this.pc.elementCache[instanceKey];
        (props as any).category = categoryId;
      }

      if (typeof this.dmo.modifyProps === "function")
        this.dmo.modifyProps(props, instance);

      const result = this.pc.updateElement(props, instance);
      this.pc.elementCache[instance.key] = result.entityId;
      this.pc.seenIds.add(result.entityId);
      results.push(result);
    }
    return results;
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
    const results: UpdateResult[] = [];
    const instances = this.pc.irModel.getRelInstances(this.dmo);
    for (const instance of instances) {
      const pair = await this.pc.getSourceTargetIdPair(this, instance);
      if (!pair)
        continue;

      const [sourceId, targetId] = pair;
      const existing = this.pc.db.relationships.tryGetInstance(this.dmo.ecEntity, { sourceId, targetId });
      if (existing)
        continue;

      const props: common.RelationshipProps = { sourceId, targetId, classFullName: this.dmo.ecEntity };
      if (typeof this.dmo.modifyProps === "function")
        this.dmo.modifyProps(props, instance);

      const relId = this.pc.db.relationships.insertInstance(props);
      results.push({ entityId: relId, state: ItemState.New });
    }
    return results;
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
    const results: UpdateResult[] = [];
    const instances = this.pc.irModel.getRelInstances(this.dmo);
    for (const instance of instances) {
      const pair = await this.pc.getSourceTargetIdPair(this, instance);
      if (!pair)
        continue;

      const [sourceId, targetId] = pair;
      const targetElement = this.pc.db.elements.getElement(targetId);
      const props: common.RelatedElementProps = { id: sourceId, relClassName: this.dmo.ecEntity };

      if (typeof this.dmo.modifyProps === "function")
        this.dmo.modifyProps(props, instance);

      const relatedElement = common.RelatedElement.fromJSON(props);
      if (!relatedElement)
        throw new Error("Failed to create RelatedElement");

      (targetElement as any)[this.dmo.relatedPropName] = relatedElement;
      targetElement.update();
      results.push({ entityId: relatedElement.id, state: ItemState.New });
    }
    return results;
  }

  public toJSON(): any {
    return { key: this.key, dmo: this.dmo, sourceNode: this.source.key, targetNode: this.target ? this.target.key : "" };
  }
}

