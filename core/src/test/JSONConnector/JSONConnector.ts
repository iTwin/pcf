import * as bk from "@bentley/imodeljs-backend";
import { KnownTestLocations } from "../KnownTestLocations";
import * as elements from "./dmos/Elements";
import * as relationships from "./dmos/Relationships";
import * as relatedElements from "./dmos/RelatedElements";
import * as pcf from "../../pcf";
import * as path from "path";
import { JSONLoader } from "../../drivers";

export default class JSONConnector extends pcf.PConnector {
  constructor() {
    super();

    this._config = {
      schemaConfig: {
        domainSchemaPaths: [
          "Functional.ecschema.xml",
          "SpatialComposition.ecschema.xml",
          "BuildingSpatial.ecschema.xml"
        ].map((file: string) => path.join(KnownTestLocations.testAssetsDir, "domain_schemas", file)),
        schemaName: "TestSchema",
        schemaAlias: "ts",
      },
      appConfig: {
        connectorName: "TestConnector",
        appId: "TestConnector",
        appVersion: "1.0.0.0",
      },
    }

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

async function run() {
  await bk.IModelHost.startup();
  const { jobArgs, hubArgs } = require("./args");
  const app = new pcf.App(jobArgs, hubArgs);
  const connector = new JSONConnector();
  const loader = new JSONLoader(app.jobArgs.dataConnection, {
    entityKeys: ["ExtPhysicalElement", "ExtPhysicalType", "ExtGroupInformationElement", "ExtSpace", "ExtCategory"],
    relKeys: ["ExtElementRefersToElements", "ExtElementRefersToExistingElements", "ExtElementGroupsMembers", "ExtPhysicalElementAssemblesElements"],
  });
  await app.signin();
  const db = await app.downloadBriefcaseDb();
  await app.runConnector(db, connector, loader);
  await bk.IModelHost.shutdown();
}
