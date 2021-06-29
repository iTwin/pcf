import * as pcf from "@itwin/pcf";

const { ElementRefersToElements, PhysicalElement } = pcf.imodeljs_backend;
const { StrengthDirection, strengthDirectionToString, strengthToString, StrengthType } = pcf.ecschema_metadata;

export const ComponentConnectsComponent: pcf.RelationshipDMO = {
  irEntity: "Connection",
  fromAttr: "SourceComponentName",
  fromType: "IREntity",
  toAttr: "TargetComponentName",
  toType: "IREntity",
  ecRelationship: {
    schema: "SampleDynamic",
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
