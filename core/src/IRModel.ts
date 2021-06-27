import * as hash from "object-hash";
import { ElementDMO, RelatedElementDMO, RelationshipDMO } from "./pcf";
import { Loader } from "./loaders/Loader";

/*
 * A virtual Entity-Relationship store read by PConnector to synchronize data into an iModel.
 *
 * IR = Intermediate Representation
 */
export class IRModel {

  public entityMap: {[key: string]: IREntity};
  public relMap: {[key: string]: IRRelationship};
  public static version: string = "1.0.0";

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
    if (!(dmo.irEntity in this.entityMap))
      return [];
    let instances = this.entityMap[dmo.irEntity].instances;
    if (typeof dmo.doSyncInstance === "function")
      instances = instances.filter(dmo.doSyncInstance);
    return instances;
  }

  public getRelInstances(dmo: RelationshipDMO | RelatedElementDMO): IRInstance[] {
    if (!(dmo.irEntity in this.relMap))
      return [];
    let instances = this.relMap[dmo.irEntity].instances;
    if (typeof dmo.doSyncInstance === "function")
      instances = instances.filter(dmo.doSyncInstance);
    return instances;
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
  instances?: IRInstance[];
}

/*
 * Represents an external object class
 * Corresponds to an EC Entity Class
 */
export class IREntity {

  public key: string;
  public instances: IRInstance[];

  constructor(props: IREntityProps) {
    this.key = props.key;
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

export interface IRInstanceProps {
  pkey: string;
  entityKey: string;
  version?: string;
  data?: {[attr: string]: any};
}

type IREntityKey = string;
type PrimaryKeyValue = string;
export type IRInstanceKey = `${IREntityKey}-${PrimaryKeyValue}`;

/*
 * Represents an external object / instance of an external object class.
 * Corresponds to an EC Instance
 */
export class IRInstance implements IRInstanceProps {

  public pkey: string;
  public entityKey: string;
  public data: {[attr: string]: any};
  public version: string;

  constructor(props: IRInstanceProps) {
    this.pkey = props.pkey;
    this.entityKey = props.entityKey;
    this.data = props.data ?? {};
    this.version = props.version ?? "";
    this.validate();
  }

  public static createKey(entityKey: string, pkv: string): IRInstanceKey {
    return `${entityKey}-${pkv}` as IRInstanceKey;
  }

  public get key(): IRInstanceKey {
    return this.codeValue;
  }

  public get codeValue(): IRInstanceKey {
    const pkv = this.get(this.pkey);
    return `${this.entityKey}-${pkv}` as IRInstanceKey;
  }

  public get userLabel(): string {
    const pkv = this.get(this.pkey);
    return pkv;
  }

  public get(attr: string): any {
    if (!(attr in this.data))
      return undefined;
    return this.data[attr];
  }

  public get checksum(): string {
    return hash.MD5(JSON.stringify(this.data));
  }

  public validate(): void {
    if (!(this.pkey in this.data))
      throw new Error(`${this.pkey} does not exist on ${this.entityKey}`);
  }
}
