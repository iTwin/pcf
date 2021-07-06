import { PhysicalElement, PhysicalElementAssemblesElements } from "@bentley/imodeljs-backend";
import { StrengthDirection, strengthDirectionToString, strengthToString, StrengthType } from "@bentley/ecschema-metadata";
import { RelatedElementDMO } from "../../../DMO";

export const ExtPhysicalElementAssemblesElements: RelatedElementDMO = {
    irEntity: "ExtPhysicalElement",
    fromAttr: "id",
    fromType: "IREntity",
    toAttr: "child",
    toType: "IREntity",
    ecProperty: "parent",
    ecRelationship: {
        name: "ExtPhysicalElementAssemblesElements",
        baseClass: PhysicalElementAssemblesElements.classFullName,
        strength: strengthToString(StrengthType.Embedding),
        strengthDirection: strengthDirectionToString(StrengthDirection.Forward),
        source: {
            polymorphic: true,
            multiplicity: "(0..1)",
            roleLabel: "assmbles",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: ["TestSchema:ExtPhysicalElement"],
        },
        target: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "is assembled by",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: ["TestSchema:ExtPhysicalElement"],
        },
    },
};
