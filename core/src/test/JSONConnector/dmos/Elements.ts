import { PrimitiveType, primitiveTypeToString } from "@bentley/ecschema-metadata";
import { GroupInformationElement, PhysicalElement, PhysicalType } from "@bentley/imodeljs-backend";
import { ElementDMO } from "../../../DMO";
import { IRInstance } from "../../../IRModel";

export const ExtPhysicalElement: ElementDMO = {
  irEntity: "ExtPhysicalElement",
  ecElement: {
    schema: "TestSchema",
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
    props.userLabel = instance.get("ExtUserLabel");
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
    schema: "TestSchema",
    name: "ExtGroupInformationElement",
    baseClass: GroupInformationElement.classFullName,
  },
};

export const ExtPhysicalType: ElementDMO = {
  irEntity: "ExtPhysicalType",
  ecElement: {
    schema: "TestSchema",
    name: "ExtPhysicalType",
    baseClass: PhysicalType.classFullName,
  },
};

export const ExtSpatialCategory: ElementDMO = {
  irEntity: "ExtSpatialCategory",
  ecElement: "BisCore:SpatialCategory",
};

