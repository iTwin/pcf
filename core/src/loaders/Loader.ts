import { IREntity, IRAttribute, IRInstance, IRRelationship } from "../IRModel";
import { PConnector } from "../PConnector";

export interface BaseConnection {
  /*
   * sourceKey is a unique identifier of a single data source (RepositoryLink) in an iModel.
   */
  sourceKey: string;
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
   * The identifier of the source file (RepositoryLink) used in iModel. 
   * Modifying this value would cause the old RepositoryLink to be deleted and a new one would be created.
   */
  sourceKey: string;

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
   * IR Entity Key => Primary Key
   */
  primaryKeyMap?: {[entityKey: string]: string}; 

  /*
   * Default Primary Key is used when a primary key is not specified in primaryKeyMap.
   */
  defaultPrimaryKey?: string;
}

export type LoaderClass = new (pc: PConnector, props: LoaderProps) => Loader;

/*
 * A Loader converts a data format into an IR Model to be consumed by PConnector while pertaining data integrity.
 * Each PConnector instance needs a Loader to access a specific end data source.
 */
export abstract class Loader {

  public props: LoaderProps;

  constructor(pc: PConnector, props: LoaderProps) {
    this.props = props;
    pc.loader = this;
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
   * Returns all the attributes of an entity (e.g. headers in xlsx, tables in database)
   */
  public abstract getAttributes(entityKey: string): Promise<IRAttribute[]>;

  /*
   * Returns all non-relationship instances (e.g. the rows of non-link tables)
   */
  public abstract getInstances(entityKey: string): Promise<IRInstance[]>;

  /*
   * Returns all relationship instances (e.g. the rows of link tables)
   */
  public abstract getRelationships(): Promise<IRRelationship[]>;

  /*
   * Returns the primary key of an entity. Data integrity may be compromised if primary key is neglected.
   */
  public getPKey(entityKey: string): string {
    if (this.props.primaryKeyMap && entityKey in this.props.primaryKeyMap)
      return this.props.primaryKeyMap[entityKey];
    if (this.props.defaultPrimaryKey)
      return this.props.defaultPrimaryKey;
    return "id";
  };
}
