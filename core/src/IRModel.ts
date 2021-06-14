import * as hash from "object-hash";
import { DMO, ElementDMO, RelatedElementDMO, RelationshipDMO } from "./pcf";
import { IDriver } from "./drivers/Driver";

/*
 * A virtual Entity-Relationship store read by PConnector to synchronize data into an iModel.
 *
 * IR = Intermediate Representation
 */
export class IRModel {

  protected _entityMap: {[key: string]: IREntity};
  protected _relMap: {[key: string]: IRRelationship};

  constructor(entities: IREntity[], relationships: IRRelationship[]) {
    this._entityMap = {};
    for (const e of entities) {
      this._entityMap[e.key] = IRModel.normalized(e);
    }
    this._relMap = {};
    for (const r of relationships) {
      this._relMap[r.key] = r;
    }
  }

  public getEntityInstances(dmo: ElementDMO): IRInstance[] {
    if (!(dmo.entity in this._entityMap))
      return [];
    let instances = this._entityMap[dmo.entity].instances;
    if (typeof dmo.doSyncInstance === "function")
      instances = instances.filter(dmo.doSyncInstance);
    return instances;
  }

  public getRelInstances(dmo: RelationshipDMO | RelatedElementDMO): IRInstance[] {
    if (!(dmo.entity in this._relMap))
      return [];
    let instances = this._relMap[dmo.entity].instances;
    if (typeof dmo.doSyncInstance === "function")
      instances = instances.filter(dmo.doSyncInstance);
    return instances;
  }

  public getAttributes(dmo: DMO): IRAttribute[] {
    if (dmo.entity in this._entityMap)
      return this._entityMap[dmo.entity].attributes;
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

  public static async fromDriver(driver: IDriver) {
    const entities = await driver.getEntities();
    let relationships: IRRelationship[] = [];
    if (typeof driver.getRelationships === "function")
      relationships = await driver.getRelationships();
    return new IRModel(entities, relationships);
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
