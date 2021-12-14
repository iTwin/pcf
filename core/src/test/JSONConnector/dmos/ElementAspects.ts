import { ElementUniqueAspect } from "@itwin/core-backend";
import { PrimitiveType, primitiveTypeToString } from "@itwin/ecschema-metadata";
import { RelatedElementProps } from "@itwin/core-common";
import { IRInstance, ElementDMO, ElementAspectDMO, PConnector } from "../../../pcf";

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
    // required
    props.element = { id: instance.get("ExistingElementId") } as RelatedElementProps;
  },
};
