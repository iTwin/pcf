/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import * as aspects from "./dmos/ElementAspects";
import * as elements from "./dmos/Elements";
import * as path from "path";
import * as pcf from "../../pcf";
import * as relatedElements from "./dmos/RelatedElements";
import * as relationships from "./dmos/Relationships";

import { CategoryOwnsSubCategories, DefinitionModel, DefinitionPartition, GroupInformationPartition, GroupModel, LinkModel, LinkPartition, PhysicalModel, PhysicalPartition, SpatialLocationModel, SpatialLocationPartition } from "@itwin/core-backend";

import { TestAPILoader } from "./APITestLoader";

export class JSONConnector extends pcf.PConnector {
  public async form() {
    new pcf.PConnectorConfig(this, {
      domainSchemaPaths: [
        path.join(__dirname, "../../../node_modules/@bentley/aec-units-schema/AecUnits.ecschema.xml"),
        path.join(__dirname, "../../../node_modules/@bentley/functional-schema/Functional.ecschema.xml"),
        path.join(__dirname, "../../../node_modules/@bentley/spatial-composition-schema/SpatialComposition.ecschema.xml"),
        path.join(__dirname, "../../../node_modules/@bentley/building-spatial-schema/BuildingSpatial.ecschema.xml"),
      ],
      dynamicSchema: {
        schemaName: "TestSchema",
        schemaAlias: "ts",
      },
      connectorName: "TestConnector",
      appId: "TestConnector",
      appVersion: "1.0.0.0",
    });

    const subject1 = new pcf.SubjectNode(this, { key: "Subject1" });
    const subject2 = new pcf.SubjectNode(this, { key: "Subject2" });

    const lnkModel1 = new pcf.ModelNode(this, {
      key: "LinkModel1",
      subject: subject1,
      modelClass: LinkModel, partitionClass: LinkPartition
    });

    const lnkModel2 = new pcf.ModelNode(this, {
      key: "LinkModel2",
      subject: subject2,
      modelClass: LinkModel,
      partitionClass: LinkPartition
    });

    const modeledRepository = new pcf.ModeledElementNode(this, {
      subject: subject1,
      model: lnkModel1,
      modelClass: LinkModel,
      key: "ModeledRepository",
      dmo: elements.ModeledRepository,
    });

    const nestedModeledRepository = new pcf.ModeledElementNode(this, {
      subject: subject1,
      parent: modeledRepository,
      modelClass: LinkModel,
      key: "NestedModeledRepository",
      dmo: elements.NestedModeledRepository,
    });

    const link = new pcf.ElementNode(this, {
      parent: nestedModeledRepository,
      key: "NestedLink",
      dmo: elements.NestedLink,
    });

    const defModel = new pcf.ModelNode(this, {
      key: "DefinitionModel1",
      subject: subject1,
      modelClass: DefinitionModel,
      partitionClass: DefinitionPartition
    });

    const phyModel = new pcf.ModelNode(this, {
      key: "PhysicalModel1",
      subject: subject1,
      modelClass: PhysicalModel,
      partitionClass: PhysicalPartition
    });

    const phyModel2 = new pcf.ModelNode(this, {
      key: "PhysicalModel2",
      subject: subject1,
      modelClass: PhysicalModel,
      partitionClass: PhysicalPartition
    });

    const grpModel = new pcf.ModelNode(this, {
      key: "GroupModel1",
      subject: subject1,
      modelClass: GroupModel,
      partitionClass: GroupInformationPartition
    });

    const sptModel = new pcf.ModelNode(this, {
      key: "SpatialLocationModel1",
      subject: subject1,
      modelClass: SpatialLocationModel,
      partitionClass: SpatialLocationPartition
    });

    new pcf.LoaderNode(this, {
      key: "json-loader-1",
      model: lnkModel1,
      loader: new pcf.JSONLoader({
        format: "json",
        entities: [
          "ExtElementAspectA", "ExtElementAspectB",
          "ExtGroupInformationElement",
          "ExtPhysicalElement",
          "ExtPhysicalType",
          "ExtSpace",
          // The right literal is prefixed 'Spatial--' because the DMO of the node the subcategory
          // attaches to makes SpatialCategory elements.
          "ExtSpatialCategory", "SpatialSubcategory",
          "ModeledRepository", "NestedModeledRepository", "NestedLink"
        ],
        relationships: [
          "ExtElementGroupsMembers",
          "ExtElementRefersToElements",
          "ExtElementRefersToExistingElements",
          "ExtExistingElementRefersToElements",
          "ExtPhysicalElement",
        ],
        defaultPrimaryKey: "id",
      }),
    });

    new pcf.LoaderNode(this, {
      key: "api-loader-1",
      model: lnkModel2,
      loader: new TestAPILoader({
        format: "rest-api",
        entities: [],
        relationships: [],
        defaultPrimaryKey: "id",
      }),
    });

    new pcf.ElementAspectNode(this, {
      key: "ExtElementAspectA",
      subject: subject1,
      dmo: aspects.ExtElementAspectA
    });

    new pcf.ElementAspectNode(this, {
      key: "ExtElementAspectB",
      subject: subject1,
      dmo: aspects.ExtElementAspectB
    });

    const sptCategory = new pcf.ElementNode(this, {
      key: "SpatialCategory1",
      model: defModel,
      dmo: elements.ExtSpatialCategory
    });

    new pcf.ElementNode(this, {
      key: "SpatialSubcategory",
      parent: {
        parent: sptCategory,
        relationship: CategoryOwnsSubCategories.classFullName
      },
      dmo: elements.SpatialSubcategory,
    });

    new pcf.ElementNode(this, {
      key: "ExtPhysicalType",
      model: defModel,
      dmo: elements.ExtPhysicalType
    });

    new pcf.ElementNode(this, {
      key: "ExtSpace",
      model: sptModel,
      dmo: elements.ExtSpace,
      category: sptCategory
    });

    const extPhysicalElement = new pcf.ElementNode(this, {
      key: "ExtPhysicalElement",
      model: phyModel,
      dmo: elements.ExtPhysicalElement,
      category: sptCategory
    });

    const extGroupInformationElement = new pcf.ElementNode(this, {
      key: "ExtGroupInformationElement",
      model: grpModel,
      dmo: elements.ExtGroupInformationElement
    });

    new pcf.RelationshipNode(this, {
      key: "ExtElementRefersToElements",
      subject: subject1,
      dmo: relationships.ExtElementRefersToElements,
      source: extPhysicalElement,
      target: extPhysicalElement,
    });

    new pcf.RelationshipNode(this, {
      key: "ExtElementRefersToExistingElements",
      subject: subject1,
      dmo: relationships.ExtElementRefersToExistingElements,
      source: extPhysicalElement,
    });

    new pcf.RelationshipNode(this, {
      key: "ExtExistingElementRefersToElements",
      subject: subject1,
      dmo: relationships.ExtExistingElementRefersToElements,
      target: extPhysicalElement,
    });

    new pcf.RelationshipNode(this, {
      key: "ExtElementGroupMembers",
      subject: subject1,
      dmo: relationships.ExtElementGroupsMembers,
      source: extGroupInformationElement,
      target: extPhysicalElement,
    });

    new pcf.RelatedElementNode(this, {
      key: "ExtPhysicalElementAssemblesElements",
      subject: subject1,
      dmo: relatedElements.ExtPhysicalElementAssemblesElements,
      source: extPhysicalElement,
      target: extPhysicalElement,
    });
  }
}

export async function getConnectorInstance() {
  const connector = new JSONConnector();
  await connector.form();
  return connector;
}
