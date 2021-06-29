import { EntityClassProps, RelationshipClassProps } from "@bentley/ecschema-metadata";
import { IRInstance } from "./IRModel";

/* 
 * A string that contains a JSON whose keys refer to EC Properties and values refer to their values.
 * The combination of this set of properties and values should uniquely identify a target element that already exists in the iModel.
 * e.g. {"ECClassId": "Bis.PhysicalElement", "CodeValue": "Wall"}
 */
export type SearchKey = string;

/*
 * In one of the following formats:
 * 1. "<schema name or alias>:<domain class name>"
 * 2. "<schema name or alias>.<domain class name>"
 */
export type ECDomainClassFullName = string;

export type ECDynamicElementClassProps = (EntityClassProps & { schema: string, name: string, baseClass: string });
export type ECDynamicRelationshipClassProps = RelationshipClassProps & { schema: string };

/*
 * Dynamic Mapping Object (solely responsible for the mapping between the IR Model and EC Model)
 */
export interface DMO {

  /*
   * References the key of an IR Entity which represents an external class (e.g. Excel sheet, database table).
   */
  irEntity: string;

  /*
   * Defines a condition to determine if an ECInstance should be created from an IRInstance.
   * The instance will not be synchronized if "false" is returned,
   */ 
  doSyncInstance?(instance: IRInstance): boolean;

  /*
   * Modifies the default properties assigned to the current ECInstance. 
   * An IRInstance contains the external data corresponding to current EC Entity.
   */
  modifyProps?(props: any, instance: IRInstance): void;
}

/*
 * Dynamic Mapping Object for EC Element Class
 */
export interface ElementDMO extends DMO {

  /*
   * References an EC Element Class by one of the following options:
   * 1. include its domain class full name 
   * 2. create a dynamic element class by defining it here
   */
  ecElement: ECDomainClassFullName | ECDynamicElementClassProps;

  /*
   * References the attribute name used to identify the EC Category Element
   */
  categoryAttr?: string;

  /*
   * References the attribute name used to identify the EC RelatedElement
   */
  relatedElementAttr?: string;
}



/*
 * Dynamic Mapping Object for EC Relationship Class
 */
export interface RelationshipDMO extends DMO {

  /*
   * References a relationship class by one of the following options:
   * 1. include its domain class full name 
   * 2. create a dynamic relationship class by defining it here
   */
  ecRelationship: ECDomainClassFullName | ECDynamicRelationshipClassProps;

  /*
   * References a primary/foreign key (attribute) that uniquely identifies a source entity.
   */
  fromAttr: string;

  /*
   * The type of the source entity.
   * Currently it must be IR Entity.
   */
  fromType: "IREntity";

  /*
   * References a primary/foreign key (attribute) that uniquely identifies a source IR/EC Entity.
   * toAttr must contain SearchKey if toType = "ECEntity" 
   */
  toAttr: SearchKey | string;

  /*
   * The type of the target entity.
   * toAttr must contain a SearchKey if toType = "ECEntity"
   */
  toType: "ECEntity" | "IREntity";
}

/*
 * Dynamic Mapping Object for EC Related Element Class.
 */
export interface RelatedElementDMO extends RelationshipDMO {

  /*
   * The name of the EC property that references an EC RelatedElement.
   * e.g. the EC property named "parent" in BisCore:PhysicalElement
   */
  ecProperty: string;
}

/*
 * Input for generating an EC Dynamic Schema
 */
export interface DMOMap {
  elements: ElementDMO[];
  relationships: RelationshipDMO[];
  relatedElements: RelatedElementDMO[];
}

// WIP: Dynamic Mapping Object for EC Aspect Class
// export interface ElementAspectDMO extends ElementDMO {}
// export interface ModelDMO extends DMO {}
