/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { IREntity, IRInstance, IRRelationship } from "../IRModel";
import { PConnector } from "../PConnector";

export interface BaseConnection {
  /*
   * loaderKey is a unique identifier of a Repository Link element in an iModel.
   * pcf will synchronize all the data stored under this subject with source file.
   */
  loaderKey: string;
}

export interface FileConnection {

  /*
   * Marks that this is a connection to a file.
   */
  kind: "pcf_file_connection";

  /* 
   * Absolute path to your local source file.
   */ 
  filepath: string;
}

export type DataConnection = BaseConnection & (FileConnection);

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
}

export type LoaderClass = new (pc: PConnector, props: LoaderProps) => Loader;

/*
 * A Loader converts a data format into an IR Model to be consumed by PConnector while pertaining data integrity.
 * Each PConnector instance needs a Loader to access a specific end data source.
 */
export abstract class Loader implements LoaderProps {

  public format: string;
  public entities: string[];
  public relationships: string[];
  public primaryKeyMap: {[entityKey: string]: string}; 
  public defaultPrimaryKey: string;

  constructor(props: LoaderProps) {
    this.format = props.format;
    this.entities = props.entities;
    this.relationships = props.relationships;
    this.defaultPrimaryKey = props.defaultPrimaryKey;
    this.primaryKeyMap = props.primaryKeyMap ?? {};
  }

  /*
   * Open connection to a data source. Must be called before loading data.
   */
  public abstract open(con: DataConnection): Promise<void>;

  /*
   * Close connection. Do nothing if open already read in the entire source file.
   */
  public abstract close(): Promise<void>;

  /*
   * Returns all the entities (e.g. all sheets in xlsx, all tables in database)
   */
  public abstract getEntities(): Promise<IREntity[]>;

  /*
   * Returns all relationship instances (e.g. the rows of link tables)
   */
  public abstract getRelationships(): Promise<IRRelationship[]>;

  /*
   * Returns all non-relationship instances (e.g. the rows of non-link tables)
   */
  public abstract getInstances(entityKey: string): Promise<IRInstance[]>;

  /*
   * Returns the primary key of an entity. Data integrity may be compromised if primary key is neglected.
   */
  public getPKey(entityKey: string): string {
    if (this.primaryKeyMap && entityKey in this.primaryKeyMap)
      return this.primaryKeyMap[entityKey];
    return this.defaultPrimaryKey
  };

  public toJSON() {
    const { format, entities, relationships, primaryKeyMap, defaultPrimaryKey } = this;
    return { format, entities, relationships, primaryKeyMap, defaultPrimaryKey };
  }
}
