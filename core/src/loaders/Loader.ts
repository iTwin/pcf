/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import { IREntity, IRInstance, IRRelationship } from "../IRModel";

import { LogCategory } from "../LogCategory";
import { Logger } from "@itwin/core-bentley";
import { PConnector } from "../PConnector";

export interface BaseConnection {
  /*
   * loaderNodeKey references a LoaderNode and is a unique identifier of a Repository Link element in an iModel.
   * pcf will synchronize all the data stored under this subject with source file.
   */
  loaderNodeKey: string;

  /*
   * Source data will be loaded into the IR Model on demand if true.
   * default = false
   */
  lazyMode?: boolean;

  /*
   * Arbitrary data
   */
  data?: any;
}

export interface FileConnection extends BaseConnection {

  /*
   * Marks that this is a connection to a file.
   */
  kind: "pcf_file_connection";

  /*
   * Absolute path to your local source file.
   */
  filepath: string;
}

export interface APIConnection extends BaseConnection {

  /*
   * Marks that this is a connection to an remote API.
   */
  kind: "pcf_api_connection";

  /*
   * Base URL to fetch data from the API
   */
  baseUrl: string;
}

export type DataConnection = FileConnection | APIConnection;

/*
 * Defined by users. A Loader fetches data according to this object.
 */
export interface LoaderProps {

  /*
   * The format of the source file used in iModel.
   * (e.g. "json", "sqlite", and "xlsx").
   */
  format: string;

  /*
   * Used IR Entity Keys. Only the IR Entities listed here will be imported to your iModel.
   */
  entities: string[];

  /*
   * Used IR Relationship Keys. Only the IR Relationships listed here will be imported to your iModel.
   */
  relationships: string[];

  /*
   * Default Primary Key is used when a primary key is not specified in primaryKeyMap.
   */
  defaultPrimaryKey: string;

  /*
   * IR Entity Key => Primary Key
   */
  primaryKeyMap?: {[entityKey: string]: string};

  /*
   * Defines the version of current loader.
   */
  version?: string;
}

export type LoaderClass = new (pc: PConnector, props: LoaderProps) => Loader;

/*
 * A Loader converts a data format into an IR Model to be consumed by PConnector while pertaining data integrity.
 * Each PConnector instance needs a Loader to access a specific end data source.
 */
export abstract class Loader {

  private _isOpen: boolean;
  private _format: string;
  private _entities: string[];
  private _relationships: string[];
  private _primaryKeyMap: {[entityKey: string]: string};
  private _defaultPrimaryKey: string;

  public version: string;

  constructor(props: LoaderProps) {
    this._isOpen = false;
    this._format = props.format;
    this._entities = props.entities;
    this._relationships = props.relationships;
    this._defaultPrimaryKey = props.defaultPrimaryKey;
    this._primaryKeyMap = props.primaryKeyMap ?? {};
    this.version = props.version ?? "0.0";
  }

  /*
   * Open connection to a data source. Must be called before loading data.
   */
  protected abstract _open(con: DataConnection): Promise<void>;

  /*
   * Close connection. Do nothing if open already read in the entire source file.
   */
  protected abstract _close(): Promise<void>;

  /*
   * Returns all the entities (e.g. all sheets in xlsx, all tables in database)
   */
  protected abstract _getEntities(): Promise<IREntity[]>;

  /*
   * Returns all relationship instances (e.g. the rows of link tables)
   */
  protected abstract _getRelationships(): Promise<IRRelationship[]>;

  /*
   * Returns all non-relationship instances (e.g. the rows of non-link tables)
   */
  protected abstract _getInstances(entityKey: string): Promise<IRInstance[]>;


  public async open(con: DataConnection): Promise<void> {
    if (this.isOpen) {
      Logger.logError(LogCategory.PCF, "Loader is already open.");
      return;
    }
    this._isOpen = true;
    await this._open(con);
  }

  public async close(): Promise<void> {
    if (!this.isOpen) {
      Logger.logError(LogCategory.PCF, "Cannot close a Loader that hasn't been opened.");
      return;
    }
    this._isOpen = false;
    await this._close();
  }

  public async getEntities(): Promise<IREntity[]> {
    const allEntities = await this._getEntities();
    return allEntities.filter((entity: IREntity) => this._entities.includes(entity.key));
  }

  public async getRelationships(): Promise<IRRelationship[]> {
    const allRels = await this._getRelationships();
    return allRels.filter((rel: IRRelationship) => this._relationships.includes(rel.key));
  }

  public async getInstances(entityKey: string): Promise<IRInstance[]> {
    const instances = await this._getInstances(entityKey);
    return instances;
  }

  public getPKey(entityKey: string): string {
    if (this._primaryKeyMap && entityKey in this._primaryKeyMap)
      return this._primaryKeyMap[entityKey];
    return this._defaultPrimaryKey;
  }

  public toJSON(): LoaderProps {
    return {
      format: this._format,
      entities: this._entities,
      relationships: this._relationships,
      primaryKeyMap: this._primaryKeyMap,
      defaultPrimaryKey: this._defaultPrimaryKey,
    };
  }

  public get isOpen() {
    return this._isOpen;
  }
}
