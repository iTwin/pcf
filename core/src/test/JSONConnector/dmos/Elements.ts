/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { PrimitiveType, primitiveTypeToString } from "@itwin/ecschema-metadata";
import { GroupInformationElement, PhysicalElement, PhysicalType, SubCategory } from "@itwin/core-backend";
import { Id64 } from "@itwin/core-bentley";
import { ElementDMO, IRInstance, PConnector } from "../../../pcf";

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
  parentAttr: "parent",
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

export const SpatialSubcategory: ElementDMO = {
  irEntity: "SpatialSubcategory",
  ecElement: SubCategory.classFullName,
  modifyProps: (connector: PConnector, props: { [property: string]: unknown }, instance: IRInstance): void => {
    props.description = instance.get("description");
  },
  parentAttr: "parent",
};
