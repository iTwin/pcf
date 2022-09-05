/*---------------------------------------------------------------------------------------------
 * Copyright (c) Bentley Systems, Incorporated. All rights reserved.
 * See LICENSE.md in the project root for license terms and full copyright notice.
 *--------------------------------------------------------------------------------------------*/
import { EntityClassProps, RelationshipClassProps } from "@itwin/ecschema-metadata";

import { IRInstance, PConnector } from "./pcf";

/**
 * A string that contains a JSON whose keys refer to EC properties and values refer to their values.
 * The combination of this set of properties and values should uniquely identify a target element
 * that already exists in the iModel.
 *
 * e.g.
 * ```ts
 * {
 *     "ECClassId": "Bis.PhysicalElement",
 *     "CodeValue": "Wall"
 * }
 * ```
 *
 * As of writing, September 5, 2022, locators only support the following types of EC properties
 * because they are parsed as JSON.
 *
 * - `string`
 * - `number`
 * - `Id64String`
 */
export type Locator = string;

/**
 * In one of the following formats:
 *
 * 1. "<schema name or alias>:<domain class name>"
 * 2. "<schema name or alias>.<domain class name>"
 */
export type ECDomainClassFullName = string;

export type ECDynamicEntityClassProps = (EntityClassProps & { name: string, baseClass: string });
export type ECDynamicElementAspectClassProps = (EntityClassProps & { name: string, baseClass: string });
export type ECDynamicRelationshipClassProps = RelationshipClassProps;

/**
 * The Dynamic Mapping Object. DMOs are solely responsible for the mapping between the IR model and
 * EC model.
 */
export interface DMO {
  /**
   * The unique key of the {@link IRModel!IREntity} whose {@link IRModel!IRInstance} this DMO is
   * responsible for mapping to instances in the iModel.
   */
  readonly irEntity: string;

  /**
   * The condition that determines if an instance in the iModel should be created from an
   * {@link IRModel!IRInstance}. The instance will not be synchronized if `false` is returned. This
   * function is always awaited in case a `Promise` is returned.
   */
  doSyncInstance?(instance: IRInstance): Promise<boolean> | boolean;

  /**
   * Modifies the default properties assigned to the given EC instance. All nodes are responsible
   * for populating the {@link IRModel!IRInstance} that belong to its {@link IRModel!IREntity} by
   * transforming them to EC instances, and this function that defines that mapping. It is awaited
   * in case a `Promise` is returned. The connector author must be extremely careful here because
   * PCF escapes TypeScript's safety and so your editor will not tell you what properties `props`
   * supports.
   */
  modifyProps?(pc: PConnector, props: any, instance: IRInstance): Promise<void> | void;
}

/**
 * The Dynamic Mapping Object or {@link DMO} for classes of BIS elements, i.e., `ECEntityClass`.
 */
export interface ElementDMO extends DMO {

  /**
   * References an `ECEntityClass` by one of the following options:
   *
   * 1. Include its class name prefixed by schema name, for example `Generic:PhysicalObject`.
   *    See {@link ECDomainClassFullName}.
   * 2. Create a dynamic element class by defining it here.
   */
  readonly ecElement: ECDomainClassFullName | ECDynamicEntityClassProps;

  /**
   * The attribute name used to identify the {@link IRModel!IRInstance#codeValue} of the category
   * element in the source data.
   */
  readonly categoryAttr?: string;

  /**
   * References the attribute name used to identify the EC RelatedElement
   *
   * @deprecated
   */
  // readonly relatedElementAttr?: string;

  /**
   * Definition of registered element class that extends an existing BIS element class
   * An example: class Component extends PhysicalElement { ... }
   *
   * @deprecated
   */
  // readonly registeredClass?: typeof BisElement;
}

/**
 * Identical to a DMO for elements, but with a mandatory `parrentAttr` property. When an element
 * node does not have a model node, it must have this DMO attached to it.
 */
export type ElementWithParentDMO = ElementDMO & { parentAttr: string };

/**
 * The Dynamic Mapping Object for `bis:ElementAspect`.
 */
export interface ElementAspectDMO extends DMO {
  /**
   * References the BIS class of this element aspect. See {@link ElementDMO#ecElement}.
   */
  readonly ecElementAspect: ECDomainClassFullName | ECDynamicEntityClassProps;
}

/**
 * The Dynamic Mapping Object for `ECRelationshipClass`.
 */
export interface RelationshipDMO extends DMO {
  /**
   * References the BIS class of this relationship. See {@link ElementDMO#ecElement}.
   */
  readonly ecRelationship: ECDomainClassFullName | ECDynamicRelationshipClassProps;

  /**
   * References a primary/foreign key (attribute) that uniquely identifies the source of the
   * relationship.
   */
  readonly fromAttr: Locator | string;

  /**
   * Whether the source object is already present in the iModel (`'ECEntity'`) or if it should come
   * from the source data (`'IREntity'`). You probably want to relate two
   * {@link IRModel!IRInstance}.
   *
   * Must be `'ECEntity'` if {@link RelationshipDMO#fromAttr} contains a {@link Locator}.
   *
   * @todo `fromAttr` and `fromType` should be written as a discriminated union.
   *
   * ```ts
   * from: { source: 'ECEntity', locator: Locator } | { source: 'IREntity', attr: string };
   * ```
   */
  readonly fromType: "IREntity" | "ECEntity";

  /**
   * References a primary/foreign key (attribute) that uniquely identifies the target of the
   * relationship.
   */
  readonly toAttr: Locator | string;

  /**
   * See {@link RelationshipDMO#fromType}.
   *
   * Must be `'ECEntity'` if {@link RelationshipDMO#toAttr} contains a {@link Locator}.
   */
  readonly toType: "IREntity" | "ECEntity";

  /**
   * Definition of registered relationship class that extends an existing BIS Relationship class
   *
   * @deprecated
   */
  // readonly registeredClass?: typeof Relationship;
}

/**
 * The Dynamic Mapping Object for navigation properties.
 *
 * @see [The PCF wiki](https://github.com/iTwin/pcf/wiki/Nodes-in-detail#navigation-properties)
 * on constructing this DMO. The inherited {@link RelationshipDMO#fromAttr} and
 * {@link RelationshipDMO#toAttr} behave differently than you'd expect from looking at the source
 * and target of the relationship you're implementing.
 */
export interface RelatedElementDMO extends RelationshipDMO {
  /**
   * The name of the navigation property as specified by the iTwin _props_ types, not as specified
   * by the BIS property. For example, the property named `Parent` in `BisCore:Element`, which
   * translates to `parent`
   * in [`ElementProps`](https://www.itwinjs.org/reference/core-common/entities/elementprops).
   */
  readonly ecProperty: string;
}

// WIP: Dynamic Mapping Object for EC Aspect Class
// export interface ElementAspectDMO extends ElementDMO {}
// export interface ModelDMO extends DMO {}
