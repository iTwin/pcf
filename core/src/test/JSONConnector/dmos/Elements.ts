import { PrimitiveType, primitiveTypeToString } from "@bentley/ecschema-metadata";
import { GroupInformationElement, PhysicalElement, PhysicalType } from "@bentley/imodeljs-backend";
import * as pcf from "../../../pcf";

export const ExtPhysicalElement: pcf.ElementDMO = {
  entity: "ExtPhysicalElement",
  classFullName: "TestSchema:ExtPhysicalElement",
  classProps: {
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
  modifyProps(props: any, instance: pcf.IRInstance) {
    props.userLabel = instance.get("ExtUserLabel");
    props.buildingNumber = instance.get("id");
    props.roomNumber = instance.get("id");
  },
  doSyncInstance(instance: pcf.IRInstance) {
    return instance.get("id") === "0" ? false : true;
  },
  categoryAttr: "category",
};

export const ExtSpace: pcf.ElementDMO = {
  entity: "ExtSpace",
  classFullName: "BuildingSpatial:Space",
  modifyProps(props: any, instance: pcf.IRInstance) {
    props.footprintArea = 10;
  },
  categoryAttr: "category",
};

export const ExtGroupInformationElement: pcf.ElementDMO = {
  entity: "ExtGroupInformationElement",
  classFullName: "TestSchema:ExtGroupInformationElement",
  classProps: {
    name: "ExtGroupInformationElement",
    baseClass: GroupInformationElement.classFullName,
  },
};

export const ExtPhysicalType: pcf.ElementDMO = {
  entity: "ExtPhysicalType",
  classFullName: "TestSchema:ExtPhysicalType",
  classProps: {
    name: "ExtPhysicalType",
    baseClass: PhysicalType.classFullName,
  },
};

export const ExtSpatialCategory: pcf.ElementDMO = {
  entity: "ExtSpatialCategory",
  classFullName: "BisCore:SpatialCategory",
};

