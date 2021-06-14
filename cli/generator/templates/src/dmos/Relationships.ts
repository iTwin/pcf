import { StrengthDirection, strengthDirectionToString, strengthToString, StrengthType } from "@bentley/ecschema-metadata";
import * as bk from "@bentley/imodeljs-backend";
import * as pcf from "@itwin/pcf";
import * as elements from "./Elements";

export const ComponentConnectsToComponent: pcf.RelationshipDMO = {
  entity: "Connection",
  fromAttr: "RowName1",
  fromType: "IREntity",
  toAttr: "RowName2",
  toType: "IREntity",
  classFullName: "COBieDynamic:ComponentConnectsToComponent",
  classProps: {
    name: "ComponentConnectsToComponent",
    baseClass: bk.ElementRefersToElements.classFullName,
    strength: strengthToString(StrengthType.Referencing),
    strengthDirection: strengthDirectionToString(StrengthDirection.Forward),
    source: {
      polymorphic: true,
      multiplicity: "(0..*)",
      roleLabel: "From Component",
      abstractConstraint: bk.PhysicalElement.classFullName,
      constraintClasses: [elements.Component.classFullName],
    },
    target: {
      polymorphic: true,
      multiplicity: "(0..*)",
      roleLabel: "To Component",
      abstractConstraint: bk.PhysicalElement.classFullName,
      constraintClasses: [elements.Component.classFullName],
    },
  },
};
