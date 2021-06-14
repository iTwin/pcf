import { EntityClassProps, RelationshipClassProps } from "@bentley/ecschema-metadata";
import { ElementProps, RelatedElementProps, RelationshipProps } from "@bentley/imodeljs-common";
import { IRInstance } from "./pcf";

export type ClassFullName = `${string}:${string}` | `${string}.${string}`;

/*
 * Dynamic Mapping Object (solely responsible for the mapping between the IR Model and EC Model)
 */
export interface DMO {

  // references the key of an IR Entity which represents an external class (e.g. Excel sheet, database table).
  entity: string;

  // dynamic / domain class name (e.g. BisCore:PhysicalElement).
  classFullName: ClassFullName;

  // define a condition to determine if an element should be created from an IR instance.
  // the instance will not be synchronized if false is returned,
  doSyncInstance?(instance: IRInstance): boolean;
}

/*
 * Dynamic Mapping Object for EC Element Class
 */
export interface ElementDMO extends DMO {

  // Dynamic Class Properties: must be defined if classFullName references a dynamic class.
  classProps?: EntityClassProps & { name: string, baseClass: string };

  // add custom properties or override the default properties (props) of current EC element. IRInstance contains the external data corresponding to current EC element.
  modifyProps?<T extends ElementProps>(props: T, instance: IRInstance): void;
}

interface BaseRelationshipDMO extends DMO {

  // a primary/foreign key that uniquely identifies a source IR/EC Entity.
  fromAttr: string;

  // the type of the source entity.
  fromType: "IREntity";

  // a primary/foreign key that uniquely identifies a target IR/EC Entity.
  //
  // if toType = "ECEntity", toAttr refers to a special attribute that contains SearchKey's.
  //
  // SearchKey: a string that contains a JSON whose keys refer to EC Properties and values refer to their values.
  // The combination of this set of properties and values should uniquely identify a target element that already exists in the iModel.
  // e.g. {"ECClassId": "Bis.PhysicalElement", "CodeValue": "Wall"}
  toAttr: string;

  // the type of the target entity.
  toType: "ECEntity" | "IREntity";

  // Dynamic Class Properties: must be defined if classFullName references a dynamic class.
  classProps?: RelationshipClassProps;
}

/*
 * Dynamic Mapping Object for EC Relationship Class
 */
export interface RelationshipDMO extends BaseRelationshipDMO {

  // add custom properties or override the default properties (props) of current EC element. IRInstance contains the external data corresponding to current EC element.
  modifyProps?<T extends RelationshipProps>(props: T, instance: IRInstance): void;
}

/*
 * Dynamic Mapping Object for EC Related Element Class.
 */
export interface RelatedElementDMO extends BaseRelationshipDMO {

  // relatedPropName: the name of property that references a RelatedElement. e.g. the property named "parent" in bis.PhysicalElement.
  relatedPropName: string;

  // add custom properties or override the default properties (props) of current EC element. IRInstance contains the external data corresponding to current EC element.
  modifyProps?<T extends RelatedElementProps>(props: T, instance: IRInstance): void;
}

/*
 * WIP: Dynamic Mapping Object for EC Aspect Class
 */
// export interface ElementAspectDMO extends ElementDMO {}

/*
 * Input for creating an EC Dynamic Schema
 */
export interface DMOMap {
  elements: ElementDMO[];
  relationships: RelationshipDMO[];
  relatedElements: RelatedElementDMO[];
}

function validateDMO(dmo: ElementDMO | RelationshipDMO | RelatedElementDMO) {
  const [schemaName, className] = dmo.classFullName.split(":");
  if (dmo.classProps && dmo.classProps.name !== className)
    throw new Error(`${dmo.classFullName}: DMO.classProps.name must be equal to the className defined in DMO.classFullName`);
}

export function validateElementDMO(dmo: ElementDMO) {
  validateDMO(dmo);
}

export function validateRelationshipDMO(dmo: RelationshipDMO) {
  validateDMO(dmo);
}

export function validateRelatedElementDMO(dmo: RelatedElementDMO) {
  validateDMO(dmo);
}
