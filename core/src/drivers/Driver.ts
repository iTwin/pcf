import { IREntity, IRAttribute, IRInstance, IRRelationship } from "../IRModel";

/*
 * Defined by users. A Loader fetches data according to this object.
 */
export interface LoaderConfig {

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
 * Defined by users. A loader uses this to retrieve data.
 */
export interface FileConnection {
  kind: "FileConnection";
  filepath: string;
}

export type DataConnection = FileConnection; 

export abstract class Loader {

  public connection: DataConnection;
  public config: LoaderConfig;

  constructor(connection: DataConnection, config: LoaderConfig) {
    this.connection = connection;
    this.config = config;
  }

  /*
   * Open connection to a data source. Must be called before loading data.
   */
  public abstract open(): Promise<void>;

  /*
   * Close connection. Do nothing if open already read in the entire source file.
   */
  public abstract close(): Promise<void>;

  /*
   * Returns all the entities (e.g. all sheets in xlsx, all tables in database)
   */
  public abstract getEntities(): Promise<IREntity[]>;

  /*
   * Returns all the attributes of an entity (e.g. headers in xlsx, tables in database)
   */
  public abstract getAttributes?(entityKey: string): Promise<IRAttribute[]>;

  /*
   * Returns all non-relationship instances (e.g. the rows of non-link tables)
   */
  public abstract getInstances(entityKey: string): Promise<IRInstance[]>;

  /*
   * Returns all relationship instances (e.g. the rows of link tables)
   */
  public abstract getRelationships?(): Promise<IRRelationship[]>;

  /*
   * Returns the primary key of an entity. Data integrity may be compromised if primary key is neglected.
   */
  public getPKey(entityKey: string): string {
    if (this.config.primaryKeyMap && entityKey in this.config.primaryKeyMap)
      return this.config.primaryKeyMap[entityKey];
    if (this.config.defaultPrimaryKey)
      return this.config.defaultPrimaryKey;
    return "id";
  };
}
