import { EntityClassProps, RelationshipClassProps } from "@bentley/ecschema-metadata";
import { ModelProps, ElementProps, RelatedElementProps, RelationshipProps } from "@bentley/imodeljs-common";
import { IRInstance } from "./pcf";

export type ClassFullName = `${string}:${string}` | `${string}.${string}`;

/*
 * Dynamic Mapping Object (solely responsible for the mapping between the IR Model and EC Model)
 */
export interface DMO {

  // references the key of an IR entity which represents an external class (e.g. Excel sheet, database table).
  irEntity: string;

  // references the ClassFullName of a dynamic / domain EC entity (e.g. BisCore:PhysicalElement).
  ecEntity: ClassFullName;

  // defines a condition to determine if an element should be created from an IR instance.
  // the instance will not be synchronized if false is returned,
  doSyncInstance?(instance: IRInstance): boolean;
}

/*
 * Dynamic Mapping Object for EC Model Class
 */
export interface ModelDMO extends DMO {
  modifyProps?<T extends ModelProps>(props: T, instance: IRInstance): void;
}

/*
 * Dynamic Mapping Object for EC Element Class
 */
export interface ElementDMO extends DMO {
  // modifies the default properties (props) of the current EC entity. IRInstance contains the external data corresponding to current EC entity.
  modifyProps?<T extends ElementProps>(props: T, instance: IRInstance): void;

  // references the column used to identify the category of an IR instance 
  categoryAttr?: string;

  // Dynamic EC Class Properties: must be defined if classFullName references a dynamic class.
  // A dynamic schema will be generated if this is defined.
  classProps?: EntityClassProps & { name: string, baseClass: string };
}

interface BaseRelationshipDMO extends DMO {

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

  // Dynamic EC Class Properties: must be defined if classFullName references a dynamic class.
  // A dynamic schema will be generated if this is defined.
  classProps?: RelationshipClassProps;
}

/*
 * Dynamic Mapping Object for EC Relationship Class
 */
export interface RelationshipDMO extends BaseRelationshipDMO {

  // modify the default properties (props) of the current EC entity. IRInstance contains the external data corresponding to current EC entity.
  modifyProps?<T extends RelationshipProps>(props: T, instance: IRInstance): void;
}

/*
 * Dynamic Mapping Object for EC Related Element Class.
 */
export interface RelatedElementDMO extends BaseRelationshipDMO {

  // relatedPropName: the name of the EC property that references a RelatedElement. e.g. the property named "parent" in BisCore:PhysicalElement.
  relatedPropName: string;

  // modify the default properties (props) of the current EC entity. IRInstance contains the external data corresponding to current EC entity.
  modifyProps?<T extends RelatedElementProps>(props: T, instance: IRInstance): void;
}

/*
 * Input for generating an EC Dynamic Schema
 */
export interface DMOMap {
  elements: ElementDMO[];
  relationships: RelationshipDMO[];
  relatedElements: RelatedElementDMO[];
}

function validateDMO(dmo: ElementDMO | RelationshipDMO | RelatedElementDMO) {
  const [schemaName, className] = dmo.ecEntity.split(":");
  if (dmo.classProps && dmo.classProps.name !== className)
    throw new Error(`${dmo.ecEntity}: DMO.classProps.name must be equal to the className defined in DMO.classFullName`);
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

// WIP: Dynamic Mapping Object for EC Aspect Class
// export interface ElementAspectDMO extends ElementDMO {}
