/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import * as sqlite from "sqlite";
import * as sqlite3 from "sqlite3";

import {
  FileConnection,
  Loader
} from "./Loader";

import {
  IREntity,
  IRInstance,
  IRRelationship
} from "../IRModel";

/*
 * SQLite => IR Model Mappings:
 *
 * Each database table = IR Entity
 * Each row of a table = IR Instance
 *
 */
export class SQLiteLoader extends Loader {

  public db?: any;

  protected async _open(con: FileConnection): Promise<void> {
    this.db = await sqlite.open({ filename: con.filepath, driver: sqlite3.Database });
  }

  protected async _close(): Promise<void> {
    this.db.close();
  }

  protected async _getEntities(): Promise<IREntity[]> {
    return this._getAll();
  }

  protected async _getRelationships(): Promise<IRRelationship[]> {
    return this._getAll();
  }

  protected async _getAll(): Promise<IREntity[]> {
    const tables: any[] = await this.db.all("select * from sqlite_master where type='table'");
    const entities: IREntity[] = [];
    for (const table of tables) {
      const entity = new IREntity({ key: table.name });
      entities.push(entity);
    }
    return entities;
  }

  protected async _getInstances(entityKey: string): Promise<IRInstance[]> {
    const rows: any[] = await this.db.all(`select * from ${entityKey}`);
    const instances: IRInstance[] = [];
    for (const row of rows) {
      const firstKey = Object.keys(row)[0];
      const pkey = this.getPKey(entityKey);
      const instance = new IRInstance({
        pkey,
        entityKey,
        data: row,
      });
      instances.push(instance);
    }
    return instances;
  }
}
