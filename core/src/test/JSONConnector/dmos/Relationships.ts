import { ElementGroupsMembers, ElementRefersToElements, GroupInformationElement, PhysicalElement } from "@bentley/imodeljs-backend";
import { StrengthDirection, strengthDirectionToString, strengthToString, StrengthType } from "@bentley/ecschema-metadata";
import { RelationshipDMO } from "../../../DMO";

export const ExtElementRefersToElements: RelationshipDMO = {
    irEntity: "ExtElementRefersToElements",
    fromAttr: "ExtPhysicalElementKey1",
    fromType: "IREntity",
    toAttr: "ExtPhysicalElementKey2",
    toType: "IREntity",
    ecRelationship: {
        schema: "TestSchema",
        name: "ExtElementRefersToElements",
        baseClass: ElementRefersToElements.classFullName,
        strength: strengthToString(StrengthType.Referencing),
        strengthDirection: strengthDirectionToString(StrengthDirection.Forward),
        source: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "From ExtPhysicalElementKey",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: ["TestSchema:ExtPhysicalElement"],
        },
        target: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "To ExtPhysicalElementKey",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: ["TestSchema:ExtPhysicalElement"],
        },
    },
};

export const ExtElementRefersToExistingElements: RelationshipDMO = {
    irEntity: "ExtElementRefersToExistingElements",
    fromAttr: "ExtPhysicalElementKey",
    fromType: "IREntity",
    toAttr: "ExistingElementSearchKey",
    toType: "ECEntity",
    ecRelationship: {
        schema: "TestSchema",
        name: "ExtElementRefersToExistingElements",
        baseClass: ElementRefersToElements.classFullName,
        strength: strengthToString(StrengthType.Referencing),
        strengthDirection: strengthDirectionToString(StrengthDirection.Forward),
        source: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "From ExtPhysicalElementKey",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: ["TestSchema:ExtPhysicalElement"],
        },
        target: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "To ExistingElementSearchKey",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: [PhysicalElement.classFullName],
        },
    },
};

export const ExtElementGroupsMembers: RelationshipDMO = {
    irEntity: "ExtElementGroupsMembers",
    fromAttr: "ExtGroupInformationElementKey",
    fromType: "IREntity",
    toAttr: "ExtPhysicalElementKey",
    toType: "IREntity",
    ecRelationship: {
        schema: "TestSchema",
        name: "ExtElementGroupsMembers",
        baseClass: ElementGroupsMembers.classFullName,
        strength: strengthToString(StrengthType.Referencing),
        strengthDirection: strengthDirectionToString(StrengthDirection.Forward),
        source: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "ExtGroupInformationElement",
            abstractConstraint: GroupInformationElement.classFullName,
            constraintClasses: ["TestSchema:ExtGroupInformationElement"],
        },
        target: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "ExtPhysicalElement",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: ["TestSchema:ExtPhysicalElement"],
        },
    },
};

