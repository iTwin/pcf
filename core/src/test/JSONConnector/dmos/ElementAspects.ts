import {
  BriefcaseDb,
  ElementUniqueAspect,
  StandaloneDb
} from "@itwin/core-backend";

import {
  ElementAspectDMO,
  IRInstance,
  PConnector
} from "../../../pcf";

import {
  PrimitiveType,
  primitiveTypeToString
} from "@itwin/ecschema-metadata";

export const ExtElementAspectA: ElementAspectDMO = {
  irEntity: "ExtElementAspectA",
  ecElementAspect: {
    name: "ExtElementAspectA",
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

export const ExtElementAspectB: ElementAspectDMO = {
  irEntity: "ExtElementAspectB",
  ecElementAspect: {
    name: "ExtElementAspectB",
    baseClass: ElementUniqueAspect.classFullName,
  },
  modifyProps(pc: PConnector, props: any, instance: IRInstance) {
    if (pc.db instanceof StandaloneDb)
      props.element = { id: instance.get("StandaloneExistingElementId") };
    else if (pc.db instanceof BriefcaseDb)
      props.element = { id: instance.get("BriefcaseExistingElementId") };
  },
};
