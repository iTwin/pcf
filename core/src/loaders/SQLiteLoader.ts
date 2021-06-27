import * as sqlite3 from "sqlite3";
import * as sqlite from "sqlite";
import { IREntity, IRInstance, IRRelationship } from "../IRModel";
import { FileConnection, Loader } from "./Loader";

export class SQLiteLoader extends Loader {

  public db?: any;

  public async open(con: FileConnection): Promise<void> {
    this.db = await sqlite.open({ filename: con.filepath, driver: sqlite3.Database });
  }

  public async close(): Promise<void> {
    this.db.close();
  }

  public async getEntities(): Promise<IREntity[]> {
    return this._getEntities(this.entities);
  }

  public async getRelationships(): Promise<IRRelationship[]> {
    return this._getEntities(this.relationships);
  }

  protected async _getEntities(usedKeys: string[]): Promise<IREntity[]> {
    const tables: any[] = await this.db.all("select * from sqlite_master where type='table'");
    const entities: IREntity[] = [];
    for (const table of tables) {
      if (!usedKeys.includes(table.name))
        continue;
      const instances = await this.getInstances(table.name);
      const entity = new IREntity({
        key: table.name,
        instances,
      });
      entities.push(entity);
    }
    return entities;
  }

  public async getInstances(entityKey: string): Promise<IRInstance[]> {
    const rows: any[] = await this.db.all(`select * from ${entityKey}`);
    const instances: IRInstance[] = [];
    for (const row of rows) {
      const firstKey = Object.keys(row)[0];
      const pkey = this.getPKey(entityKey) ?? [firstKey];
      const instance = new IRInstance({
        pkey,
        entityKey,
        data: row,
      });
      instances.push(instance);
    }
    return instances;
  }

  public getTsType(colType: string): string {
    const numTypes = new Set(["INT", "INTEGER", "DOUBLE", "REAL", "FLOAT"]);
    const boolTypes = new Set(["BOOlEAN"]);
    let tsType = "string";
    if (numTypes.has(colType))
      tsType = "number";
    if (boolTypes.has(colType))
      tsType = "boolean";
    return tsType;
  }
}
