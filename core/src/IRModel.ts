/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import * as hash from "object-hash";

import { DataConnection, LogCategory } from "./pcf";

import { Loader } from "./loaders/Loader";
import { Logger } from "@itwin/core-bentley";

/*
 * A virtual Entity-Relationship store generated by a Loader and read by PConnector to synchronize data into an iModel.
 * IR Model safe-guards the integrity of the external source data and normalize them if necessary.
 *
 * All the source data for PCF must first be mapped to an IR Model.
 *
 * IR = Intermediate Representation
 */
export class IRModel {

  private _connection: DataConnection;
  private _lazyMode: boolean;
  private _loader: Loader;
  private _entityMap: { [entityKey: string]: IREntity };
  private _relMap: { [relationshipKey: string]: IRRelationship };

  constructor(loader: Loader, con: DataConnection) {
    this._lazyMode = con.lazyMode ?? false;
    this._loader = loader;
    this._connection = con;
    this._entityMap = {};
    this._relMap = {};
  }

  public get lazyMode() {
    return this._lazyMode;
  }

  public addEntity(entity: IREntity) {
    if (entity.key in this._entityMap) {
      Logger.logWarning(LogCategory.PCF, `IR Entity ${entity.key} already exists in IR Model.`);
      return;
    }
    this._entityMap[entity.key] = entity;
    if (entity.instances)
      entity.instances = IRModel.normalized(entity.instances);
  }

  public addRelationship(rel: IRRelationship) {
    if (rel.key in this._relMap) {
      Logger.logWarning(LogCategory.PCF, `IR Relationship Entity ${rel.key} already exists in IR Model.`);
      return;
    }
    this._relMap[rel.key] = rel;
    if (rel.instances)
      rel.instances = IRModel.normalized(rel.instances);
  }

  public deleteEntity(entity: IREntity) {
    if (!(entity.key in this._entityMap)) {
      Logger.logWarning(LogCategory.PCF, `IR Entity ${entity.key} does not exist in IR Model.`);
      return;
    }
    delete this._entityMap[entity.key];
  }

  public deleteRelationship(rel: IRRelationship) {
    if (!(rel.key in this._relMap)) {
      Logger.logWarning(LogCategory.PCF, `IR Relationship Entity ${rel.key} does not exist in IR Model.`);
      return;
    }
    delete this._relMap[rel.key];
  }

  public async getEntityInstances(irEntity: string): Promise<IRInstance[]> {
    if (!(irEntity in this._entityMap)) {
      Logger.logWarning(LogCategory.PCF, `Cannot find IR Entity ${irEntity}`);
      return [];
    }

    const entity = this._entityMap[irEntity];
    if (!entity.instances)
      entity.instances = await this._loader.getInstances(irEntity);

    return entity.instances;
  }

  public async getRelationshipInstances(irRelationship: string): Promise<IRInstance[]> {
    if (!(irRelationship in this._relMap)) {
      Logger.logWarning(LogCategory.PCF, `Cannot find IR Relationship Entity ${irRelationship}`);
      return [];
    }

    const rel = this._relMap[irRelationship];
    if (!rel.instances)
      rel.instances = await this._loader.getInstances(irRelationship);

    return rel.instances;
  }

  public static normalized(instances: IRInstance[]): IRInstance[] {
    const m: {[k: string]: IRInstance} = {};
    for (const instance of instances) {
      if (instance.key in m)
        continue;
      m[instance.key.toLowerCase()] = instance;
    }
    const newInstances = Object.values(m);
    return newInstances;
  }

  public async load() {
    await this._loader.open(this._connection);

    const entities = await this._loader.getEntities();
    const relationships: IRRelationship[] = await this._loader.getRelationships();

    for (const entity of entities) {
      if (!this.lazyMode)
        entity.instances = await this._loader.getInstances(entity.key);
      this.addEntity(entity);
    }
    for (const relationship of relationships) {
      if (!this.lazyMode)
        relationship.instances = await this._loader.getInstances(relationship.key);
      this.addRelationship(relationship);
    }
  }

  public async clear() {
    this._entityMap = {};
    this._relMap = {};
    if (this._lazyMode)
      await this._loader.close();
  }
}

export interface IREntityProps {

  /*
   * Unique identifier of an IR Entity
   */
  key: string;

	/*
   * All the IR Instances that belong to this IR Enitty
   */
  instances?: IRInstance[];
}

/*
 * Represents an external object class
 *
 * An IR Entity corresponds to an EC Entity
 */
export class IREntity {

  public key: string;
  public instances?: IRInstance[];

  constructor(props: IREntityProps) {
    this.key = props.key;
    this.instances = props.instances;
  }
}

export type IRRelationshipProps = IREntityProps

/*
 * Represents an external object class that describes relationships. (e.g. link tables)
 *
 * An IR Relationship corresponds to an EC Relationship
 */
export class IRRelationship extends IREntity {
  constructor(props: IRRelationshipProps) {
    super(props);
  }
}

export interface IRInstanceProps {

  /*
   * Primary Key
   */
  pkey: string;

  /*
   * References an IR Entity
   */
  entityKey: string;

  /*
   * Contains the value for keeping track of versions used in an external source
   */
  version?: string;

  /*
   * Contains all the data associated with current IR Instance
   */
  data?: {[attr: string]: any};
}

/*
 * Unique identifier of an IR Entity
 */
type IREntityKey = string;

/*
 * The primary-key-value (ID) of an IR Instance
 */
type PrimaryKeyValue = string;

/*
 * A unique identifier of an IR Instance
 */
export type IRInstanceKey = `${IREntityKey}-${PrimaryKeyValue}`;

/*
 * Represents an external object / instance of an external object class.
 *
 * An IR Instance corresponds to an EC Instance
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

  /*
   * Unique Identifier of an IRInstance
   */
  public get key(): IRInstanceKey {
    return this.codeValue;
  }

  /*
   * Primary Key Value (pkv)
   */
  public get pkv(): string {
    return this.get(this.pkey);
  }

  /*
   * Corresponding BIS Code Value
   */
  public get codeValue(): IRInstanceKey {
    return `${this.entityKey}-${this.pkv}` as IRInstanceKey;
  }

  /*
   * Corresponding BIS User Label
   */
  public get userLabel(): string {
    const pkv = this.get(this.pkey);
    return pkv;
  }

  public get checksum(): string {
    return hash.MD5(JSON.stringify(this.data));
  }

  public get(attr: string): any {
    if (!(attr in this.data))
      return undefined;
    return this.data[attr];
  }

  public validate(): void {
    if (!(this.pkey in this.data))
      throw new Error(`${this.pkey} does not exist on ${this.entityKey}`);
  }
}
