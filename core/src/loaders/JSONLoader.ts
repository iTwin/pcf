import { IREntity, IRInstance, IRRelationship } from "../IRModel";
import { FileConnection, Loader } from "./Loader";
import * as fs from "fs";

// json must be formatted like this:
// 
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

export class JSONLoader extends Loader {

  public json: any = {};

  public async open(con: FileConnection): Promise<void> {
    this.json = JSON.parse(fs.readFileSync(con.filepath, "utf8"));
  }

  public async close(): Promise<void> {}

  public async getEntities(): Promise<IREntity[]> {
    return this._getEntities(this.entities);
  }

  public async getRelationships(): Promise<IRRelationship[]> {
    return this._getEntities(this.relationships);
  }

  protected async _getEntities(usedKeys: string[]): Promise<IREntity[]> {
    const keys = Object.keys(this.json);
    const entities: IREntity[] = [];
    for (const key of keys) {
      if (!usedKeys.includes(key))
        continue;
      const instances = await this.getInstances(key);
      const entity = new IREntity({ key, instances });
      entities.push(entity);
    }
    return entities;
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
