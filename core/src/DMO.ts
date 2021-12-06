/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { EntityClassProps, RelationshipClassProps } from "@itwin/ecschema-metadata";
import { IRInstance, PConnector } from "./pcf";

/* 
 * A string that contains a JSON whose keys refer to EC Properties and values refer to their values.
 * The combination of this set of properties and values should uniquely identify a target element that already exists in the iModel.
 * e.g. {"ECClassId": "Bis.PhysicalElement", "CodeValue": "Wall"}
 */
export type Locator = string;

/*
 * In one of the following formats:
 * 1. "<schema name or alias>:<domain class name>"
 * 2. "<schema name or alias>.<domain class name>"
 */
export type ECDomainClassFullName = string;

export type ECDynamicElementClassProps = (EntityClassProps & { name: string, baseClass: string });
export type ECDynamicRelationshipClassProps = RelationshipClassProps;

/*
 * Dynamic Mapping Object (solely responsible for the mapping between the IR Model and EC Model)
 */
export interface DMO {

  /*
   * References the key of an IR Entity which represents an external class (e.g. Excel sheet, database table).
   */
  readonly irEntity: string;

  /*
   * Defines a condition to determine if an ECInstance should be created from an IRInstance.
   * The instance will not be synchronized if "false" is returned.
   * This function is always awaited in case if a Promise is returned.
   */ 
  doSyncInstance?(instance: IRInstance): Promise<boolean> | boolean;

  /*
   * Modifies the default properties assigned to the current ECInstance. 
   * An IRInstance contains the external data corresponding to current EC Entity.
   * This function is always awaited in case if a Promise is returned.
   */
  modifyProps?(pc: PConnector, props: any, instance: IRInstance): Promise<void> | void;
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
  readonly ecElement: ECDomainClassFullName | ECDynamicElementClassProps;

  /*
   * References the attribute name used to identify the EC Category Element
   */
  readonly categoryAttr?: string;

  /*
   * References the attribute name used to identify the EC RelatedElement
   */
  readonly relatedElementAttr?: string;

  /*
   * Definition of registered element class that extends an existing BIS element class
   * An example: class Component extends PhysicalElement { ... }
   */
  // readonly registeredClass?: typeof BisElement;
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
  readonly ecRelationship: ECDomainClassFullName | ECDynamicRelationshipClassProps;

  /*
   * References a primary/foreign key (attribute) that uniquely identifies a source entity.
   */
  readonly fromAttr: Locator | string;

  /*
   * The type of the source entity.
   * Currently it must be IR Entity.
   */
  readonly fromType: "IREntity" | "ECEntity";

  /*
   * References a primary/foreign key (attribute) that uniquely identifies a source IR/EC Entity.
   * toAttr must contain Locator if toType = "ECEntity" 
   */
  readonly toAttr: Locator | string;

  /*
   * The type of the target entity.
   * toAttr must contain a Locator if toType = "ECEntity"
   */
  readonly toType: "IREntity" | "ECEntity";

  /*
   * Definition of registered relationship class that extends an existing BIS Relationship class
   */
  // readonly registeredClass?: typeof Relationship;
}

/*
 * Dynamic Mapping Object for EC Related Element Class.
 */
export interface RelatedElementDMO extends RelationshipDMO {

  /*
   * The name of the EC property that references an EC RelatedElement.
   * e.g. the EC property named "parent" in BisCore:PhysicalElement
   */
  readonly ecProperty: string;
}

// WIP: Dynamic Mapping Object for EC Aspect Class
// export interface ElementAspectDMO extends ElementDMO {}
// export interface ModelDMO extends DMO {}
