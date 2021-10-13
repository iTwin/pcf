/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { PrimitiveType, primitiveTypeToString } from "@itwin/ecschema-metadata";
import { GroupInformationElement, PhysicalElement, PhysicalType } from "@itwin/core-backend";
import { ElementDMO } from "../../../DMO";
import { IRInstance } from "../../../IRModel";

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
  modifyProps(props: any, instance: IRInstance) {
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
  modifyProps(props: any, instance: IRInstance) {
    props.footprintArea = 10;
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
  modifyProps(props: any, instance: IRInstance) {
    props.userLabel = instance.get("ExtUserLabel");
  },
};

export const ExtSpatialCategory: ElementDMO = {
  irEntity: "ExtSpatialCategory",
  ecElement: "BisCore:SpatialCategory",
};

