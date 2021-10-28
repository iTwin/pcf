import { DefinitionModel, DefinitionPartition, LinkModel, LinkPartition, PhysicalModel, PhysicalPartition } from "@itwin/core-backend";
import * as pcf from "@itwin/pcf";
import * as elements from "./dmos/Elements";
import * as relationships from "./dmos/Relationships";
import * as relatedElements from "./dmos/RelatedElements";
import * as path from "path";

export class <%= className %> extends pcf.PConnector {
  public async form() {
    new pcf.PConnectorConfig(this, {
      connectorName: "SampleConnector",
      appId: "SampleConnector",
      appVersion: "1.0.0.0",
      domainSchemaPaths: [
        path.join(__dirname, "../node_modules/@bentley/functional-schema/Functional.ecschema.xml"),
      ],
      dynamicSchema: {
        schemaName: "SampleDynamic",
        schemaAlias: "sd",
      },
    });

    const subject1 = new pcf.SubjectNode(this, { key: "sample-subject-1" });

    const linkModel = new pcf.ModelNode(this, { key: "LoaderLinkModel", subject: subject1, modelClass: LinkModel, partitionClass: LinkPartition });
    const loader = new pcf.LoaderNode(this, {
      key: "sample-xlsx-loader",
      model: linkModel,
      loader: new pcf.XLSXLoader({
        format: "xlsx",
        entities: ["Component", "Category"],
        relationships: ["Component", "Connection"],
        defaultPrimaryKey: "Name",
      }),
    });

    const defModel = new pcf.ModelNode(this, { key: "DefinitionModel-1", subject: subject1, modelClass: DefinitionModel, partitionClass: DefinitionPartition });
    const phyModel = new pcf.ModelNode(this, { key: "PhysicalModel-1", subject: subject1, modelClass: PhysicalModel, partitionClass: PhysicalPartition });
    const category = new pcf.ElementNode(this, { key: "SpatialCategory-1", model: defModel, dmo: elements.ComponentCategory });
    const component = new pcf.ElementNode(this, { key: "Component-1", model: phyModel, dmo: elements.Component, category: category });

    new pcf.RelationshipNode(this, {
      key: "ComponentConnectsComponent",
      subject: subject1,
      dmo: relationships.ComponentConnectsComponent,
      source: component,
      target: component,
    });

    new pcf.RelatedElementNode(this, {
      key: "ComponentAssemblesComponents",
      subject: subject1,
      dmo: relatedElements.ComponentAssemblesComponents,
      source: component,
      target: component,
    });
  }
}

export async function getConnectorInstance() {
  const connector = new <%= className %>();
  await connector.form();
  return connector;
}

