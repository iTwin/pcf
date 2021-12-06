import { PhysicalElementAssemblesElements, PhysicalElement } from "@itwin/core-backend";
import { StrengthDirection, strengthDirectionToString, strengthToString, StrengthType } from "@itwin/ecschema-metadata";
import * as pcf from "@itwin/pcf";

export const ComponentAssemblesComponents: pcf.RelatedElementDMO = {
  irEntity: "Component",
  ecProperty: "parent",
  fromAttr: "Name",
  fromType: "IREntity",
  toAttr: "ChildName",
  toType: "IREntity",
  ecRelationship: {
    name: "ComponentAssemblesComponents",
    baseClass: PhysicalElementAssemblesElements.classFullName,
    strength: strengthToString(StrengthType.Embedding),
    strengthDirection: strengthDirectionToString(StrengthDirection.Forward),
    source: {
      polymorphic: true,
      multiplicity: "(0..1)",
      roleLabel: "assmbles",
      abstractConstraint: PhysicalElement.classFullName,
      constraintClasses: ["SampleDynamic:Component"],
    },
    target: {
      polymorphic: true,
      multiplicity: "(0..*)",
      roleLabel: "is assembled by",
      abstractConstraint: PhysicalElement.classFullName,
      constraintClasses: ["SampleDynamic:Component"],
    },
  },
};
