import { ElementGroupsMembers, ElementRefersToElements, GroupInformationElement, PhysicalElement } from "@bentley/imodeljs-backend";
import { StrengthDirection, strengthDirectionToString, strengthToString, StrengthType } from "@bentley/ecschema-metadata";
import * as pcf from "../../../pcf";
import * as elements from "./Elements";

export const ExtElementRefersToElements: pcf.RelationshipDMO = {
    irEntity: "ExtElementRefersToElements",
    fromAttr: "ExtPhysicalElementKey1",
    fromType: "IREntity",
    toAttr: "ExtPhysicalElementKey2",
    toType: "IREntity",
    ecEntity: "TestSchema:ExtElementRefersToElements",
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
            constraintClasses: [elements.ExtPhysicalElement.ecEntity],
        },
        target: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "To ExtPhysicalElementKey",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: [elements.ExtPhysicalElement.ecEntity],
        },
    },
};

export const ExtElementRefersToExistingElements: pcf.RelationshipDMO = {
    irEntity: "ExtElementRefersToExistingElements",
    fromAttr: "ExtPhysicalElementKey",
    fromType: "IREntity",
    toAttr: "ExistingElementSearchKey",
    toType: "ECEntity",
    ecEntity: "TestSchema:ExtElementRefersToExistingElements",
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
            constraintClasses: [elements.ExtPhysicalElement.ecEntity],
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
    irEntity: "ExtElementGroupsMembers",
    fromAttr: "ExtGroupInformationElementKey",
    fromType: "IREntity",
    toAttr: "ExtPhysicalElementKey",
    toType: "IREntity",
    ecEntity: "TestSchema:ExtElementGroupsMembers",
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
            constraintClasses: [elements.ExtGroupInformationElement.ecEntity],
        },
        target: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "ExtPhysicalElement",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: [elements.ExtPhysicalElement.ecEntity],
        },
    },
};

