import * as elements from "./dmos/Elements";
import * as relationships from "./dmos/Relationships";
import * as relatedElements from "./dmos/RelatedElements";
import * as bk from "@bentley/imodeljs-backend";
import * as pcf from "@itwin/pcf";

export class <%= className %> extends pcf.PConnector {
  constructor() {
    super();

    new pcf.PConnectorConfig(this, {
      connectorName: "SampleConnector",
      appId: "SampleConnector",
      appVersion: "1.0.0.0",
      domainSchemaPaths: [],
      dynamicSchema: {
        schemaName: "SampleDynamic",
        schemaAlias: "sd",
      },
    });

    new pcf.XLSXLoader(this, {
      key: "sample-xlsx-loader",
      format: "xlsx",
      entities: ["Component", "Category"],
      relationships: ["Connection"],
    });

    const subject1 = new pcf.SubjectNode(this, { key: "sample-subject-1" });

    const defModel = new pcf.ModelNode(this, { key: "DefinitionModel-1", subject: subject1, modelClass: bk.DefinitionModel, partitionClass: bk.DefinitionPartition });
    const phyModel = new pcf.ModelNode(this, { key: "PhysicalModel-1", subject: subject1, modelClass: bk.PhysicalModel, partitionClass: bk.PhysicalPartition });
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

export default () => new <%= className %>();

