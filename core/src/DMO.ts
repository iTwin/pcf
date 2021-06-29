import { EntityClassProps, RelationshipClassProps } from "@bentley/ecschema-metadata";
import { IRInstance } from "./IRModel";

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
   * Rreferences EITHER a domain entity class by including its ClassFullName OR a dynamic class by defining it here
   */
  ecElement: ECDomainClassFullName | ECDynamicElementClassProps;

  // references the attribute used to identify the Category of a geometric element
  categoryAttr?: string;

  // references the attribute used to identify the RelatedElement of an element
  relatedElementAttr?: string;
}


/*
 * Dynamic Mapping Object for EC Relationship Class
 */
export interface RelationshipDMO extends DMO {

  // references EITHER a domain relationship class by including its ClassFullName OR a dynamic class by defining it here
  ecRelationship: ECDomainClassFullName | ECDynamicRelationshipClassProps;

  // references a primary/foreign key (attribute) that uniquely identifies a source entity.
  fromAttr: string;

  // the type of the source entity.
  fromType: "IREntity";

  // references a primary/foreign key (attribute) that uniquely identifies a source IR/EC Entity.
  //
  // if toType = "ECEntity", toAttr refers to a special attribute that contains SearchKey's.
  //
  // SearchKey: a string that contains a JSON whose keys refer to EC Properties and values refer to their values.
  // The combination of this set of properties and values should uniquely identify a target element that already exists in the iModel.
  // e.g. {"ECClassId": "Bis.PhysicalElement", "CodeValue": "Wall"}
  toAttr: string;

  // the type of the target entity.
  toType: "ECEntity" | "IREntity";
}

/*
 * Dynamic Mapping Object for EC Related Element Class.
 */
export interface RelatedElementDMO extends RelationshipDMO {
  // ecProperty: the name of the EC property that references a RelatedElement. e.g. the property named "parent" in BisCore:PhysicalElement.
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
