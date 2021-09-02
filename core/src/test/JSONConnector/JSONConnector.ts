/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import * as bk from "@bentley/imodeljs-backend";
import * as elements from "./dmos/Elements";
import * as relationships from "./dmos/Relationships";
import * as relatedElements from "./dmos/RelatedElements";
import * as pcf from "../../pcf";
import * as path from "path";
import { TestAPILoader } from "./APITestLoader";
import { PConnectorConfig } from "../../PConnector";

export class JSONConnector extends pcf.PConnector {
  public async form() {
    new PConnectorConfig(this, {
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

    const lnkModel1 = new pcf.ModelNode(this, { key: "LinkModel1", subject: subject1, modelClass: bk.LinkModel, partitionClass: bk.LinkPartition });
    const lnkModel2 = new pcf.ModelNode(this, { key: "LinkModel2", subject: subject2, modelClass: bk.LinkModel, partitionClass: bk.LinkPartition });
    const defModel = new pcf.ModelNode(this, { key: "DefinitionModel1", subject: subject1, modelClass: bk.DefinitionModel, partitionClass: bk.DefinitionPartition });
    const phyModel = new pcf.ModelNode(this, { key: "PhysicalModel1", subject: subject1, modelClass: bk.PhysicalModel, partitionClass: bk.PhysicalPartition });
    const phyModel2 = new pcf.ModelNode(this, { key: "PhysicalModel2", subject: subject1, modelClass: bk.PhysicalModel, partitionClass: bk.PhysicalPartition });
    const grpModel = new pcf.ModelNode(this, { key: "GroupModel1", subject: subject1, modelClass: bk.GroupModel, partitionClass: bk.GroupInformationPartition });
    const sptModel = new pcf.ModelNode(this, { key: "SpatialLocationModel1", subject: subject1, modelClass: bk.SpatialLocationModel, partitionClass: bk.SpatialLocationPartition });

    new pcf.LoaderNode(this, { 
      key: "json-loader-1", 
      model: lnkModel1, 
      loader: new pcf.JSONLoader({
        format: "json",
        entities: ["ExtPhysicalElement", "ExtPhysicalType", "ExtGroupInformationElement", "ExtSpace", "ExtSpatialCategory"],
        relationships: ["ExtPhysicalElement", "ExtElementRefersToElements", "ExtElementRefersToExistingElements", "ExtElementGroupsMembers"],
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

export async function getBridgeInstance() {
  const connector = new JSONConnector();
  await connector.form();
  return connector;
}

