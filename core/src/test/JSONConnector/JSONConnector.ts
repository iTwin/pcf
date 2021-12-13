/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { LinkModel, LinkPartition, DefinitionModel, DefinitionPartition, PhysicalModel, PhysicalPartition, GroupModel, GroupInformationPartition, SpatialLocationModel, SpatialLocationPartition } from "@itwin/core-backend";
import * as path from "path";
import * as elements from "./dmos/Elements";
import * as relationships from "./dmos/Relationships";
import * as relatedElements from "./dmos/RelatedElements";
import * as pcf from "../../pcf";
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

    const lnkModel1 = new pcf.ModelNode(this, { key: "LinkModel1", subject: subject1, modelClass: LinkModel, partitionClass: LinkPartition });
    const lnkModel2 = new pcf.ModelNode(this, { key: "LinkModel2", subject: subject2, modelClass: LinkModel, partitionClass: LinkPartition });
    const defModel = new pcf.ModelNode(this, { key: "DefinitionModel1", subject: subject1, modelClass: DefinitionModel, partitionClass: DefinitionPartition });
    const phyModel = new pcf.ModelNode(this, { key: "PhysicalModel1", subject: subject1, modelClass: PhysicalModel, partitionClass: PhysicalPartition });
    const phyModel2 = new pcf.ModelNode(this, { key: "PhysicalModel2", subject: subject1, modelClass: PhysicalModel, partitionClass: PhysicalPartition });
    const grpModel = new pcf.ModelNode(this, { key: "GroupModel1", subject: subject1, modelClass: GroupModel, partitionClass: GroupInformationPartition });
    const sptModel = new pcf.ModelNode(this, { key: "SpatialLocationModel1", subject: subject1, modelClass: SpatialLocationModel, partitionClass: SpatialLocationPartition });

    new pcf.LoaderNode(this, { 
      key: "json-loader-1", 
      model: lnkModel1, 
      loader: new pcf.JSONLoader({
        format: "json",
        entities: ["ExtPhysicalElement", "ExtElementAspect", "ExtPhysicalType", "ExtGroupInformationElement", "ExtSpace", "ExtSpatialCategory"],
        relationships: ["ExtPhysicalElement", "ExtElementRefersToElements", "ExtElementRefersToExistingElements", "ExtExistingElementRefersToElements", "ExtElementGroupsMembers"],
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

    const sptCategory = new pcf.ElementNode(this, { key: "SpatialCategory1", model: defModel, dmo: elements.ExtSpatialCategory });
    const aspect = new pcf.ElementNode(this, { key: "ExtElementAspect", model: defModel, dmo: elements.ExtElementAspect });
    const extPhysicalType = new pcf.ElementNode(this, { key: "ExtPhysicalType", model: defModel, dmo: elements.ExtPhysicalType });

    const space = new pcf.ElementNode(this, { key: "ExtSpace", model: sptModel, dmo: elements.ExtSpace, category: sptCategory });
    const extPhysicalElement = new pcf.ElementNode(this, { key: "ExtPhysicalElement", model: phyModel, dmo: elements.ExtPhysicalElement, category: sptCategory });
    const extGroupInformationElement = new pcf.ElementNode(this, { key: "ExtGroupInformationElement", model: grpModel, dmo: elements.ExtGroupInformationElement });

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

