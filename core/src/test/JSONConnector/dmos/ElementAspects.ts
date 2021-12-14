import { BriefcaseDb, ElementUniqueAspect, StandaloneDb } from "@itwin/core-backend";
import { PrimitiveType, primitiveTypeToString } from "@itwin/ecschema-metadata";
import { IRInstance, ElementAspectDMO, PConnector } from "../../../pcf";

export const ExtElementAspect: ElementAspectDMO = {
  irEntity: "ExtElementAspect",
  ecElementAspect: {
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
    props.name = instance.get("Name");
    props.type = instance.get("Type");

    // ID has different values in StandaloneDb & BriefcaseDb
    if (pc.db instanceof StandaloneDb)
      props.element = { id: instance.get("StandaloneExistingElementId") };
    else if (pc.db instanceof BriefcaseDb)
      props.element = { id: instance.get("BriefcaseExistingElementId") };
  },
};
