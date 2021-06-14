import { IREntity, IRAttribute, IRInstance, IRRelationship } from "../IRModel";

/*
 * Defined by users. A Driver fetches data according to this object.
 */
export interface DriverConfig {

  /*
   * Used Entity Keys
   */
  entityKeys: string[];

  /*
   * Used Relationship Keys
   */
  relKeys: string[];

  /*
   * Entity Key => Primary Key
   */
  primaryKeyMap?: {[entityKey: string]: string}; 

  /*
   * Default Primary Key is used when a primary key is not specified in primaryKeyMap.
   */
  defaultPrimaryKey?: string;
}

/*
 * An interface that all Drivers must implement. It is used to generate an IR Model.
 */
export interface IDriver {

  /*
   * Open connection to a data source.
   */
  open(srcDataPath?: string): Promise<void>;

  /*
   * Close connection. Do nothing if open already read in the entire source file.
   */
  close(): Promise<void>;

  /*
   * Returns all the entities (e.g. all sheets in xlsx, all tables in database)
   */
  getEntities(): Promise<IREntity[]>;

  /*
   * Returns all the attributes of an entity (e.g. headers in xlsx, tables in database)
   */
  getAttributes?(entityKey: string): Promise<IRAttribute[]>;

  /*
   * Returns all non-relationship instances (e.g. the rows of non-link tables)
   */
  getInstances(entityKey: string): Promise<IRInstance[]>;

  /*
   * Returns all relationship instances (e.g. the rows of link tables)
   */
  getRelationships?(): Promise<IRRelationship[]>;

  /*
   * Returns the primary key of an entity. Data integrity may be compromised if primary key is neglected.
   */
  getPKey(entityKey: string): string;
}
