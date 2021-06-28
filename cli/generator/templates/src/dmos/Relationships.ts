import { StrengthDirection, strengthDirectionToString, strengthToString, StrengthType } from "@bentley/ecschema-metadata";
import * as bk from "@bentley/imodeljs-backend";
import * as pcf from "@itwin/pcf";
import * as elements from "./Elements";

export const ComponentConnectsComponent: pcf.RelationshipDMO = {
  irEntity: "Connection",
  ecEntity: "SampleDynamic:ComponentConnectsToComponent",
  fromAttr: "SourceComponentName",
  fromType: "IREntity",
  toAttr: "TargetComponentName",
  toType: "IREntity",
  classProps: {
    name: "ComponentConnectsComponent",
    baseClass: bk.ElementRefersToElements.classFullName,
    strength: strengthToString(StrengthType.Referencing),
    strengthDirection: strengthDirectionToString(StrengthDirection.Forward),
    source: {
      polymorphic: true,
      multiplicity: "(0..*)",
      roleLabel: "From Component",
      abstractConstraint: bk.PhysicalElement.classFullName,
      constraintClasses: [elements.Component.ecEntity],
    },
    target: {
      polymorphic: true,
      multiplicity: "(0..*)",
      roleLabel: "To Component",
      abstractConstraint: bk.PhysicalElement.classFullName,
      constraintClasses: [elements.Component.ecEntity],
    },
  },
};
