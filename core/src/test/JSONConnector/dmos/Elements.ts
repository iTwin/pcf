/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { PrimitiveType, primitiveTypeToString } from "@itwin/ecschema-metadata";
import { GroupInformationElement, PhysicalElement, ElementUniqueAspect, PhysicalType } from "@itwin/core-backend";
import { RelatedElementProps } from "@itwin/core-common";
import { IRInstance, ElementDMO, PConnector } from "../../../pcf";

export const ExtPhysicalElement: ElementDMO = {
  irEntity: "ExtPhysicalElement",
  ecElement: {
    name: "ExtPhysicalElement",
    baseClass: PhysicalElement.classFullName,
    properties: [
      {
        name: "BuildingNumber",
        type: primitiveTypeToString(PrimitiveType.String),
      },
      {
        name: "RoomNumber",
        type: primitiveTypeToString(PrimitiveType.String),
      },
    ],
  },
  modifyProps(pc: PConnector, props: any, instance: IRInstance) {
    props.buildingNumber = instance.get("id");
    props.roomNumber = instance.get("id");
  },
  doSyncInstance(instance: IRInstance) {
    return instance.get("id") === "0" ? false : true;
  },
  categoryAttr: "category",
};

export const ExtSpace: ElementDMO = {
  irEntity: "ExtSpace",
  ecElement: "BuildingSpatial:Space",
  async modifyProps(pc: PConnector, props: any, instance: IRInstance) {
    props.footprintArea = 10;

    // Test if async is properly awaited
    await new Promise(resolve => setTimeout(resolve, 1000));
  },
  categoryAttr: "category",
};

export const ExtGroupInformationElement: ElementDMO = {
  irEntity: "ExtGroupInformationElement",
  ecElement: {
    name: "ExtGroupInformationElement",
    baseClass: GroupInformationElement.classFullName,
  },
};

export const ExtElementAspect: ElementDMO = {
  irEntity: "ExtElementAspect",
  ecElement: {
    name: "ExtElementAspect",
    baseClass: ElementUniqueAspect.classFullName,
    properties: [
      {
        name: "Name",
        type: primitiveTypeToString(PrimitiveType.String),
      },
      {
        name: "Type",
        type: primitiveTypeToString(PrimitiveType.String),
      },
    ],
  },
  modifyProps(pc: PConnector, props: any, instance: IRInstance) {
    // console.log(props);
    // console.log(instance);
    props.name = instance.get("Name");
    props.type = instance.get("Type");
    props.element = { id: instance.get("ExistingElementId") } as RelatedElementProps;
  },
};

export const ExtPhysicalType: ElementDMO = {
  irEntity: "ExtPhysicalType",
  ecElement: {
    name: "ExtPhysicalType",
    baseClass: PhysicalType.classFullName,
  },
  modifyProps(pc: PConnector, props: any, instance: IRInstance) {
    props.userLabel = instance.get("ExtUserLabel");
  },
};

export const ExtSpatialCategory: ElementDMO = {
  irEntity: "ExtSpatialCategory",
  ecElement: "BisCore:SpatialCategory",
};

