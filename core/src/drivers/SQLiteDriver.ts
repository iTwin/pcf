import * as sqlite3 from "sqlite3";
import * as sqlite from "sqlite";
import { IRAttribute, IREntity, IRInstance, IRRelationship } from "../IRModel";
import { IDriver, DriverConfig } from "./Driver";

export interface SQLiteDriverConfig extends DriverConfig {}

export class SQLiteDriver implements IDriver {

  public db?: any;
  public config: SQLiteDriverConfig;
  public tableToPKey: {[tableName: string]: string};

  constructor(config: SQLiteDriverConfig) {
    this.tableToPKey = {};
    this.config = config;
  }

  public async open(srcDataPath: string) {
    this.db = await sqlite.open({ filename: srcDataPath, driver: sqlite3.Database });
  }

  public async close() {
    this.db.close();
  }

  public async getEntities(): Promise<IREntity[]> {
    return this._getEntities(this.config.entityKeys);
  }

  public async getRelationships(): Promise<IRRelationship[]> {
    return this._getEntities(this.config.relKeys);
  }

  protected async _getEntities(usedKeys: string[]): Promise<IREntity[]> {
    const tables: any[] = await this.db.all("select * from sqlite_master where type='table'");
    const entities: IREntity[] = [];
    for (const table of tables) {
      if (usedKeys.includes(table.name))
        continue;
      const attributes = await this.getAttributes(table.name);
      const instances = await this.getInstances(table.name);
      const entity = new IREntity({
        key: table.name,
        attributes,
        instances,
      });
      entities.push(entity);
    }
    return entities;
  }

  public async getAttributes(entityKey: string): Promise<IRAttribute[]> {
    const cols: any[] = await this.db.all(`PRAGMA table_info(${entityKey})`);
    const attrs: IRAttribute[] = [];
    for (const col of cols) {
      const tsType = this.getTsType(col.type);
      const attr = new IRAttribute({
        key: col.name,
        entityKey,
        tsType,
        isPrimary: col.pk === 1,
      });
      attrs.push(attr);

      if (col.isPrimary)
        this.tableToPKey[entityKey] = col.key;
    }
    return attrs;
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

  public getPKey(entityKey: string) {
    if (this.tableToPKey[entityKey])
      return this.tableToPKey[entityKey];
    if (this.config.primaryKeyMap && entityKey in this.config.primaryKeyMap)
      return this.config.primaryKeyMap[entityKey];
    if (this.config.defaultPrimaryKey)
      return this.config.defaultPrimaryKey;
    return "id";
  }
}
