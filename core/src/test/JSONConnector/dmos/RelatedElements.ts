import { Element as BisElement, PhysicalElement, PhysicalElementAssemblesElements } from "@bentley/imodeljs-backend";
import { StrengthDirection, strengthDirectionToString, strengthToString, StrengthType } from "@bentley/ecschema-metadata";
import * as pcf from "../../../pcf";
import * as elements from "./Elements";

export const ExtPhysicalElementAssemblesElements: pcf.RelatedElementDMO = {
    entity: "ExtPhysicalElementAssemblesElements",
    fromAttr: "ExtPhysicalElementKey1",
    fromType: "IREntity",
    toAttr: "ExtPhysicalElementKey2",
    toType: "IREntity",
    classFullName: "TestSchema:ExtPhysicalElementAssemblesElements",
    relatedPropName: "parent",
    classProps: {
        name: "ExtPhysicalElementAssemblesElements",
        baseClass: PhysicalElementAssemblesElements.classFullName,
        strength: strengthToString(StrengthType.Embedding),
        strengthDirection: strengthDirectionToString(StrengthDirection.Forward),
        source: {
            polymorphic: true,
            multiplicity: "(0..1)",
            roleLabel: "assmbles",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: [elements.ExtPhysicalElement.classFullName],
        },
        target: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "is assembled by",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: [elements.ExtPhysicalElement.classFullName],
        },
    },
};
