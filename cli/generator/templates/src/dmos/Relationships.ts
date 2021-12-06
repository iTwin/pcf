import { ElementRefersToElements, PhysicalElement } from "@itwin/core-backend";
import { StrengthDirection, strengthDirectionToString, strengthToString, StrengthType } from "@itwin/ecschema-metadata";
import * as pcf from "@itwin/pcf";

export const ComponentConnectsComponent: pcf.RelationshipDMO = {
  irEntity: "Connection",
  fromAttr: "SourceComponentName",
  fromType: "IREntity",
  toAttr: "TargetComponentName",
  toType: "IREntity",
  ecRelationship: {
    name: "ComponentConnectsComponent",
    baseClass: ElementRefersToElements.classFullName,
    strength: strengthToString(StrengthType.Referencing),
    strengthDirection: strengthDirectionToString(StrengthDirection.Forward),
    source: {
      polymorphic: true,
      multiplicity: "(0..*)",
      roleLabel: "From Component",
      abstractConstraint: PhysicalElement.classFullName,
      constraintClasses: ["SampleDynamic:Component"],
    },
    target: {
      polymorphic: true,
      multiplicity: "(0..*)",
      roleLabel: "To Component",
      abstractConstraint: PhysicalElement.classFullName,
      constraintClasses: ["SampleDynamic:Component"],
    },
  },
};
