import * as bk from "@bentley/imodeljs-backend";
import KnownTestLocations from "../KnownTestLocations";
import * as elements from "./dmos/Elements";
import * as relationships from "./dmos/Relationships";
import * as relatedElements from "./dmos/RelatedElements";
import * as pcf from "../../pcf";
import * as path from "path";
import { PConnectorConfig } from "../../PConnector";

export class JSONConnector extends pcf.PConnector {
  constructor() {
    super();

    new PConnectorConfig(this, {
      domainSchemaPaths: [
        "Functional.ecschema.xml",
        "SpatialComposition.ecschema.xml",
        "BuildingSpatial.ecschema.xml"
      ].map((file: string) => path.join(KnownTestLocations.testAssetsDir, "domain_schemas", file)),
      dynamicSchema: {
        schemaName: "TestSchema",
        schemaAlias: "ts",
      },
      connectorName: "TestConnector",
      appId: "TestConnector",
      appVersion: "1.0.0.0",
    });

    const subject1 = new pcf.SubjectNode(this, { key: "Subject1" });

    new pcf.JSONLoader(this, {
      key: "json-loader-1",
      format: "json",
      entities: ["ExtPhysicalElement", "ExtPhysicalType", "ExtGroupInformationElement", "ExtSpace", "ExtSpatialCategory"],
      relationships: ["ExtElementRefersToElements", "ExtElementRefersToExistingElements", "ExtElementGroupsMembers", "ExtPhysicalElementAssemblesElements"],
    });

    const defModel = new pcf.ModelNode(this, { key: "DefinitionModel1", parentNode: subject1, modelClass: bk.DefinitionModel, partitionClass: bk.DefinitionPartition });
    const phyModel = new pcf.ModelNode(this, { key: "PhysicalModel1", parentNode: subject1, modelClass: bk.PhysicalModel, partitionClass: bk.PhysicalPartition });
    const phyModel2 = new pcf.ModelNode(this, { key: "PhysicalModel2", parentNode: subject1, modelClass: bk.PhysicalModel, partitionClass: bk.PhysicalPartition });
    const grpModel = new pcf.ModelNode(this, { key: "GroupModel1", parentNode: subject1, modelClass: bk.GroupModel, partitionClass: bk.GroupInformationPartition });
    const sptModel = new pcf.ModelNode(this, { key: "SpatialLocationModel1", parentNode: subject1, modelClass: bk.SpatialLocationModel, partitionClass: bk.SpatialLocationPartition });

    const sptCategory = new pcf.ElementNode(this, { key: "SpatialCategory1", parentNode: defModel, dmo: elements.ExtSpatialCategory });
    const extPhysicalType = new pcf.ElementNode(this, { key: "ExtPhysicalType", parentNode: defModel, dmo: elements.ExtPhysicalType });
    const space = new pcf.ElementNode(this, { key: "ExtSpace", parentNode: sptModel, dmo: elements.ExtSpace, category: sptCategory });
    const extPhysicalElement = new pcf.ElementNode(this, { key: "ExtPhysicalElement", parentNode: phyModel, dmo: elements.ExtPhysicalElement, category: sptCategory });
    const extGroupInformationElement = new pcf.ElementNode(this, { key: "ExtGroupInformationElement", parentNode: grpModel, dmo: elements.ExtGroupInformationElement });

    new pcf.RelationshipNode(this, {
      key: "ExtElementRefersToElements",
      dmo: relationships.ExtElementRefersToElements,
      source: extPhysicalElement,
      target: extPhysicalElement,
    });

    new pcf.RelationshipNode(this, {
      key: "ExtElementRefersToExistingElements",
      dmo: relationships.ExtElementRefersToExistingElements,
      source: extPhysicalElement,
    });

    new pcf.RelationshipNode(this, {
      key: "ExtElementGroupMembers",
      dmo: relationships.ExtElementGroupsMembers,
      source: extGroupInformationElement,
      target: extPhysicalElement,
    });

    new pcf.RelatedElementNode(this, {
      key: "ExtPhysicalElementAssemblesElements",
      dmo: relatedElements.ExtPhysicalElementAssemblesElements,
      source: extPhysicalElement,
      target: extPhysicalElement,
    });
  }
}

export default () => new JSONConnector();
