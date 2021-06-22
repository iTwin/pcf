import * as hash from "object-hash";
import { DMO, ElementDMO, RelatedElementDMO, RelationshipDMO } from "./pcf";
import { FileConnection, Loader } from "./drivers/Driver";

/*
 * A virtual Entity-Relationship store read by PConnector to synchronize data into an iModel.
 *
 * IR = Intermediate Representation
 */
export class IRModel {

  public entityMap: {[key: string]: IREntity};
  public relMap: {[key: string]: IRRelationship};

  constructor(entities: IREntity[], relationships: IRRelationship[]) {
    this.entityMap = {};
    for (const e of entities) {
      this.entityMap[e.key] = IRModel.normalized(e);
    }
    this.relMap = {};
    for (const r of relationships) {
      this.relMap[r.key] = r;
    }
  }

  public getEntityInstances(dmo: ElementDMO): IRInstance[] {
    if (!(dmo.entity in this.entityMap))
      return [];
    let instances = this.entityMap[dmo.entity].instances;
    if (typeof dmo.doSyncInstance === "function")
      instances = instances.filter(dmo.doSyncInstance);
    return instances;
  }

  public getRelInstances(dmo: RelationshipDMO | RelatedElementDMO): IRInstance[] {
    if (!(dmo.entity in this.relMap))
      return [];
    let instances = this.relMap[dmo.entity].instances;
    if (typeof dmo.doSyncInstance === "function")
      instances = instances.filter(dmo.doSyncInstance);
    return instances;
  }

  public getAttributes(dmo: DMO): IRAttribute[] {
    if (dmo.entity in this.entityMap)
      return this.entityMap[dmo.entity].attributes;
    return [];
  }

  public static normalized(entity: IREntity): IREntity {
    const m: {[k: string]: IRInstance} = {};
    for (const instance of entity.instances) {
      if (instance.key in m)
        continue;
      m[instance.key.toLowerCase()] = instance;
    }
    const newInstances = Object.values(m);
    entity.instances = newInstances;
    return entity;
  }

  public static async fromLoader(loader: Loader) {
    await loader.open();
    const entities = await loader.getEntities();
    let relationships: IRRelationship[] = [];
    if (typeof loader.getRelationships === "function")
      relationships = await loader.getRelationships();
    await loader.close();
    return new IRModel(entities, relationships);
  }

  public static compare(modelA: IRModel, modelB: IRModel): boolean {
    const entityMapA = modelA.entityMap;
    const entityMapB = modelB.entityMap;
    if (JSON.stringify(entityMapA) !== JSON.stringify(entityMapB))
      return false;

    const relMapA = modelA.relMap;
    const relMapB = modelB.relMap;
    if (JSON.stringify(relMapA) !== JSON.stringify(relMapB))
      return false;
    
    return true;
  }
}

export interface IREntityProps {
  key: string;
  attributes?: IRAttribute[];
  instances?: IRInstance[];
}

/*
 * Represents an external object class
 * Corresponds to an EC Entity Class
 */
export class IREntity {

  public key: string;
  public attributes: IRAttribute[];
  public instances: IRInstance[];

  constructor(props: IREntityProps) {
    this.key = props.key;
    this.attributes = props.attributes ?? [];
    this.instances = props.instances ?? [];
  }
}

export interface IRRelationshipProps extends IREntityProps {}

/*
 * Represents an external object class that describes relationships. (e.g. link tables)
 * Corresponds to an EC Relationship Class
 */
export class IRRelationship extends IREntity {
  constructor(props: IRRelationshipProps) {
    super(props);
  }
}

export interface IRAttributeProps {
  key: string;
  entityKey: string;
  tsType: string;
  isPrimary: boolean;
}

/*
 * Represents an attribute of an external object class. (e.g. columns of a database table)
 * Corresponds to an EC Property
 */
export class IRAttribute {

  public key: string;
  public entityKey: string;
  public tsType: string;
  public isPrimary: boolean;

  constructor(props: IRAttributeProps) {
    this.key = props.key; this.entityKey = props.entityKey;
    this.tsType = props.tsType;
    this.isPrimary = props.isPrimary;
  }
}

export interface IRInstanceProps {
  pkey: string;
  entityKey: string;
  data?: {[attr: string]: any};
}

type IREntityKey = string;
type PrimaryKeyValue = string;
export type IRInstanceCodeValue = `${IREntityKey}-${PrimaryKeyValue}`;

/*
 * Represents an external object / instance of an external object class.
 * Corresponds to an EC Instance
 */
export class IRInstance {

  public key: IRInstanceCodeValue;
  public pkey: string;
  public entityKey: string;
  public data: {[attr: string]: any};

  constructor(props: IRInstanceProps) {
    this.pkey = props.pkey;
    this.entityKey = props.entityKey;
    this.data = props.data ?? {};
    this.key = this.codeValue();
    this.validate();
  }

  public codeValue(): IRInstanceCodeValue {
    const pkv = this.get(this.pkey);
    return `${this.entityKey}-${pkv}` as IRInstanceCodeValue;
  }

  public userLabel(): string {
    const pkv = this.get(this.pkey);
    return pkv;
  }

  public get(attr: string): any {
    if (!(attr in this.data))
      return undefined;
    return this.data[attr];
  }

  public checksum(): string {
    return hash.MD5(JSON.stringify(this.data));
  }

  public validate(): void {
    if (!(this.pkey in this.data))
      throw new Error(`${this.pkey} does not exist on ${this.entityKey}`);
  }
}
