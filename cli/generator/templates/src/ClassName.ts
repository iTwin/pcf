import * as elements from "./dmos/Elements";
import * as relationships from "./dmos/Relationships";
import * as relatedElements from "./dmos/RelatedElements";
import * as pcf from "@itwin/pcf";
import * as path from "path";

const { DefinitionModel, DefinitionPartition, PhysicalModel, PhysicalPartition } = pcf.imodeljs_backend;

export class <%= className %> extends pcf.PConnector {
  constructor() {
    super();

    new pcf.PConnectorConfig(this, {
      connectorName: "SampleConnector",
      appId: "SampleConnector",
      appVersion: "1.0.0.0",
      domainSchemaPaths: [
        path.join(__dirname, "../assets/Functional.ecschema.xml"),
      ],
      dynamicSchema: {
        schemaName: "SampleDynamic",
        schemaAlias: "sd",
      },
    });

    const subject1 = new pcf.SubjectNode(this, { key: "sample-subject-1" });

    const linkModel = new pcf.ModelNode(this, { key: "LoaderLinkModel", subject: subject1, modelClass: DefinitionModel, partitionClass: DefinitionPartition });
    const loader = new pcf.LoaderNode(this, {
      key: "sample-xlsx-loader",
      model: linkModel,
      loader: new pcf.XLSXLoader({
        format: "xlsx",
        entities: ["Component", "Category"],
        relationships: ["Connection"],
        defaultPrimaryKey: "Name",
      }),
    });

    const defModel = new pcf.ModelNode(this, { key: "DefinitionModel-1", subject: subject1, modelClass: DefinitionModel, partitionClass: DefinitionPartition });
    const phyModel = new pcf.ModelNode(this, { key: "PhysicalModel-1", subject: subject1, modelClass: PhysicalModel, partitionClass: PhysicalPartition });
    const category = new pcf.ElementNode(this, { key: "SpatialCategory-1", model: defModel, dmo: elements.ComponentCategory });
    const component = new pcf.ElementNode(this, { key: "Component-1", model: phyModel, dmo: elements.Component, category: category });

    new pcf.RelationshipNode(this, {
      key: "ComponentConnectsComponent",
      dmo: relationships.ComponentConnectsComponent,
      source: component,
      target: component,
    });

    new pcf.RelatedElementNode(this, {
      key: "ComponentAssemblesComponents",
      dmo: relatedElements.ComponentAssemblesComponents,
      source: component,
      target: component,
    });
  }
}

export function getBridgeInstance() {
  return new <%= className %>();
}

