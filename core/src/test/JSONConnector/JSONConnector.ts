import * as bk from "@bentley/imodeljs-backend";
import { KnownTestLocations } from "../KnownTestLocations";
import * as elements from "./dmos/Elements";
import * as relationships from "./dmos/Relationships";
import * as relatedElements from "./dmos/RelatedElements";
import * as testDrivers from "../TestDrivers";
import * as pcf from "../../pcf";
import * as path from "path";

export class JSONConnector extends pcf.PConnector {
  constructor(params: pcf.PConnectorConfig) {
    super(params);

    const defModel = new pcf.ModelNode(this, { key: "DefinitionModel1", bisClass: bk.DefinitionModel, partitionClass: bk.DefinitionPartition });
    const phyModel = new pcf.ModelNode(this, { key: "PhysicalModel1", bisClass: bk.PhysicalModel, partitionClass: bk.PhysicalPartition });
    const phyModel2 = new pcf.ModelNode(this, { key: "PhysicalModel2", bisClass: bk.PhysicalModel, partitionClass: bk.PhysicalPartition });
    const grpModel = new pcf.ModelNode(this, { key: "GroupModel1", bisClass: bk.GroupModel, partitionClass: bk.GroupInformationPartition });
    const sptModel = new pcf.ModelNode(this, { key: "SpatialLocationModel1", bisClass: bk.SpatialLocationModel, partitionClass: bk.SpatialLocationPartition });

    const sptCategory = new pcf.ElementNode(this, { key: "SpatialCategory1", parent: defModel, bisClass: bk.SpatialCategory });
    const sptCategory2 = new pcf.ElementNode(this,  { key: "SpatialCategory2", parent: defModel, bisClass: bk.SpatialCategory });

    const extPhysicalType = new pcf.MultiElementNode(this, { key: "ExtPhysicalType", parent: defModel, dmo: elements.ExtPhysicalType });
    const drwCategory = new pcf.MultiElementNode(this, { key: "DrawingCategory1", parent: defModel, dmo: elements.ExtCategory });
    const space = new pcf.MultiElementNode(this, { key: "ExtSpace", parent: sptModel, dmo: elements.ExtSpace, category: sptCategory });
    const extPhysicalElement = new pcf.MultiElementNode(this, { key: "ExtPhysicalElement", parent: phyModel, dmo: elements.ExtPhysicalElement, category: sptCategory });
    const extGroupInformationElement = new pcf.MultiElementNode(this, { key: "ExtGroupInformationElement", parent: grpModel, dmo: elements.ExtGroupInformationElement });

    new pcf.MultiRelationshipNode(this, {
      key: "ExtElementRefersToElements",
      dmo: relationships.ExtElementRefersToElements,
      source: extPhysicalElement,
      target: extPhysicalElement,
    });

    new pcf.MultiRelationshipNode(this, {
      key: "ExtElementRefersToExistingElements",
      dmo: relationships.ExtElementRefersToExistingElements,
      source: extPhysicalElement,
    });

    new pcf.MultiRelationshipNode(this, {
      key: "ExtElementGroupMembers",
      dmo: relationships.ExtElementGroupsMembers,
      source: extGroupInformationElement,
      target: extPhysicalElement,
    });

    new pcf.MultiRelatedElementNode(this, {
      key: "ExtPhysicalElementAssemblesElements",
      dmo: relatedElements.ExtPhysicalElementAssemblesElements,
      source: extPhysicalElement,
      target: extPhysicalElement,
    });
  }
}

export function getBridgeInstance() {
  return new JSONConnector({
    schemaConfig: {
      domainSchemaPaths: [
        "Functional.ecschema.xml",
        "SpatialComposition.ecschema.xml",
        "BuildingSpatial.ecschema.xml"
      ].map((file: string) => path.join(KnownTestLocations.testAssetsDir, "domain_schemas", file)),
      schemaName: "TestSchema",
      schemaAlias: "ts",
    },
    connectorName: "TestConnector",
    appId: "TestConnector",
    appVersion: "1.0.0.0",
    driver: testDrivers.testJSONDriver,
  });
}

