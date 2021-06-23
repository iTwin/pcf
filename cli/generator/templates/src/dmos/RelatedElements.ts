import { StrengthDirection, strengthDirectionToString, strengthToString, StrengthType } from "@bentley/ecschema-metadata";
import * as bk from "@bentley/imodeljs-backend";
import * as pcf from "@itwin/pcf";
import * as elements from "./Elements";

export const ComponentAssemblesComponents: pcf.RelatedElementDMO = {
  entity: "Assembly",
  relatedPropName: "parent",
  fromAttr: "ParentName",
  fromType: "IREntity",
  toAttr: "ChildNames",
  toType: "IREntity",
  classFullName: "COBieDynamic:ComponentAssemblesComponents",
  classProps: {
    name: "ComponentAssemblesComponents",
    baseClass: bk.PhysicalElementAssemblesElements.classFullName,
    strength: strengthToString(StrengthType.Embedding),
    strengthDirection: strengthDirectionToString(StrengthDirection.Forward),
    source: {
      polymorphic: true,
      multiplicity: "(0..1)",
      roleLabel: "assmbles",
      abstractConstraint: bk.PhysicalElement.classFullName,
      constraintClasses: [elements.Component.classFullName],
    },
    target: {
      polymorphic: true,
      multiplicity: "(0..*)",
      roleLabel: "is assembled by",
      abstractConstraint: bk.PhysicalElement.classFullName,
      constraintClasses: [elements.Component.classFullName],
    },
  },
};