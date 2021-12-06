/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { ElementGroupsMembers, ElementRefersToElements, GroupInformationElement, PhysicalElement } from "@itwin/core-backend";
import { StrengthDirection, strengthDirectionToString, strengthToString, StrengthType } from "@itwin/ecschema-metadata";
import { RelationshipDMO } from "../../../DMO";

export const ExtElementRefersToElements: RelationshipDMO = {
    irEntity: "ExtElementRefersToElements",
    fromAttr: "ExtPhysicalElementKey1",
    fromType: "IREntity",
    toAttr: "ExtPhysicalElementKey2",
    toType: "IREntity",
    ecRelationship: {
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
    toAttr: "ExistingElementLocator",
    toType: "ECEntity",
    ecRelationship: {
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
            roleLabel: "To ExistingElementLocator",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: [PhysicalElement.classFullName],
        },
    },
};

export const ExtExistingElementRefersToElements: RelationshipDMO = {
    irEntity: "ExtExistingElementRefersToElements",
    fromAttr: "ExistingElementLocator",
    fromType: "ECEntity",
    toAttr: "ExtPhysicalElementKey",
    toType: "IREntity",
    ecRelationship: {
        name: "ExtExistingElementRefersToElements",
        baseClass: ElementRefersToElements.classFullName,
        strength: strengthToString(StrengthType.Referencing),
        strengthDirection: strengthDirectionToString(StrengthDirection.Forward),
        source: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "To ExistingElementLocator",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: [PhysicalElement.classFullName],
        },
        target: {
            polymorphic: true,
            multiplicity: "(0..*)",
            roleLabel: "From ExtPhysicalElementKey",
            abstractConstraint: PhysicalElement.classFullName,
            constraintClasses: ["TestSchema:ExtPhysicalElement"],
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

