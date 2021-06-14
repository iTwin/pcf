import { ElementGroupsMembers, ElementRefersToElements, GroupInformationElement, PhysicalElement } from "@bentley/imodeljs-backend";
import { StrengthDirection, strengthDirectionToString, strengthToString, StrengthType } from "@bentley/ecschema-metadata";
import * as pcf from "../../../pcf";
import * as elements from "./Elements";

export const ExtElementRefersToElements: pcf.RelationshipDMO = {
    entity: "ExtElementRefersToElements",
    fromAttr: "ExtPhysicalElementKey1",
    fromType: "IREntity",
    toAttr: "ExtPhysicalElementKey2",
    toType: "IREntity",
    classFullName: "TestSchema:ExtElementRefersToElements",
    classProps: {
        name: "ExtElementRefersToElements",
        baseClass: ElementRefersToElements.classFullName,
        strength: strengthToString(StrengthType.Referencing),
        strengthDirection: strengthDirectionToString(StrengthDirection.Forward),
        source: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "From ExtPhysicalElementKey",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: [elements.ExtPhysicalElement.classFullName],
        },
        target: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "To ExtPhysicalElementKey",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: [elements.ExtPhysicalElement.classFullName],
        },
    },
};

export const ExtElementRefersToExistingElements: pcf.RelationshipDMO = {
    entity: "ExtElementRefersToExistingElements",
    fromAttr: "ExtPhysicalElementKey",
    fromType: "IREntity",
    toAttr: "ExistingElementSearchKey",
    toType: "ECEntity",
    classFullName: "TestSchema:ExtElementRefersToExistingElements",
    classProps: {
        name: "ExtElementRefersToExistingElements",
        baseClass: ElementRefersToElements.classFullName,
        strength: strengthToString(StrengthType.Referencing),
        strengthDirection: strengthDirectionToString(StrengthDirection.Forward),
        source: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "From ExtPhysicalElementKey",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: [elements.ExtPhysicalElement.classFullName],
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

export const ExtElementGroupsMembers: pcf.RelationshipDMO = {
    entity: "ExtElementGroupsMembers",
    fromAttr: "ExtGroupInformationElementKey",
    fromType: "IREntity",
    toAttr: "ExtPhysicalElementKey",
    toType: "IREntity",
    classFullName: "TestSchema:ExtElementGroupsMembers",
    classProps: {
        name: "ExtElementGroupsMembers",
        baseClass: ElementGroupsMembers.classFullName,
        strength: strengthToString(StrengthType.Referencing),
        strengthDirection: strengthDirectionToString(StrengthDirection.Forward),
        source: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "ExtGroupInformationElement",
            abstractConstraint: GroupInformationElement.classFullName,
            constraintClasses: [elements.ExtGroupInformationElement.classFullName],
        },
        target: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "ExtPhysicalElement",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: [elements.ExtPhysicalElement.classFullName],
        },
    },
};

