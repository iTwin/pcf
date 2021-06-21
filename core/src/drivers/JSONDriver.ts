import { IRAttribute, IREntity, IRInstance, IRRelationship } from "../IRModel";
import { Loader, LoaderConfig, LoaderConnection } from "./Driver";
import * as fs from "fs";

// sample json format
// {
//      <EntityKey>: [ // Instances
//          {
// .            id: ...
//              <Attribute 1>: ...
//              <Attribute 2>: ...
//              ...
//          }
//      ]
// }

export interface JSONLoaderConnection extends LoaderConnection {
  filepath: string;
}

export interface JSONLoaderConfig extends LoaderConfig {}

export class JSONLoader extends Loader {

  public json: any;
  public config: JSONLoaderConfig;

  constructor(config: JSONLoaderConfig) {
    super(config);
    this.config = config;
    this.json = {};
  }

  public async open(con: JSONLoaderConnection): Promise<void> {
    this.json = JSON.parse(fs.readFileSync(con.filepath, "utf8"));
  }

  public async close(): Promise<void> {}

  public async getEntities(): Promise<IREntity[]> {
    return this._getEntities(this.config.entityKeys);
  }

  public async getRelationships(): Promise<IRRelationship[]> {
    return this._getEntities(this.config.relKeys);
  }

  protected async _getEntities(usedKeys: string[]): Promise<IREntity[]> {
    const keys = Object.keys(this.json);
    const entities: IREntity[] = [];
    for (const key of keys) {
      if (!usedKeys.includes(key))
        continue;
      const attributes = await this.getAttributes(key);
      const instances = await this.getInstances(key);
      const entity = new IREntity({ key, attributes, instances });
      entities.push(entity);
    }
    return entities;
  }

  public async getAttributes(entityKey: string): Promise<IRAttribute[]> {
    if (!(entityKey in this.json))
      throw new Error(`Source data does not have any entity named - ${entityKey}`);

    const objs = this.json[entityKey];
    const firstObj = objs[0];
    if (!firstObj)
      return [];

    const attrs: IRAttribute[] = [];
    const subkeys = Object.keys(firstObj);
    for (const subkey of subkeys) {
      const isPrimary = this.getPKey(entityKey) === subkey ? true : false;
      const attr = new IRAttribute({
        key: subkey,
        entityKey,
        tsType: typeof firstObj[subkey],
        isPrimary,
      });
      attrs.push(attr);
    }
    return attrs;
  }

  public async getInstances(entityKey: string): Promise<IRInstance[]> {
    if (!(entityKey in this.json))
      throw new Error(`Source data does not have any entity named - ${entityKey}`);

    const objs = this.json[entityKey];
    const instances: IRInstance[] = [];
    const pkey = this.getPKey(entityKey);
    for (const obj of objs) {
      const instance = new IRInstance({
        pkey,
        entityKey,
        data: obj,
      });
      instances.push(instance);
    }
    return instances;
  }
}
