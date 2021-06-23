import * as elements from "./dmos/Elements";
import * as relationships from "./dmos/Relationships";
import * as relatedElements from "./dmos/RelatedElements";
import * as bk from "@bentley/imodeljs-backend";
import * as pcf from "@itwin/pcf";

export class <%= className %> extends pcf.PConnector {
  constructor() {
    super();

    const config = new pcf.PConnectorConfig(this, {
      connectorName: "SampleConnector",
      appId: "SampleConnector",
      appVersion: "1.0.0.0",
      domainSchemaPaths: [],
      dynamicSchema: {
        schemaName: "COBieDynamic",
        schemaAlias: "cd",
      },
      loader: {
        entityKeys: ["Component"],
        relKeys: ["Connection", "Assembly"],
      },
    });

    const defModel = new pcf.ModelNode(this, { key: "DefinitionModel1", bisClass: bk.DefinitionModel, partitionClass: bk.DefinitionPartition });
    const phyModel = new pcf.ModelNode(this, { key: "PhysicalModel1", bisClass: bk.PhysicalModel, partitionClass: bk.PhysicalPartition });
    const sptCategory = new pcf.ElementNode(this, { key: "SpatialCategory1", parent: defModel, bisClass: bk.SpatialCategory });
    const component = new pcf.MultiElementNode(this, { key: "Component", parent: phyModel, dmo: elements.Component, category: sptCategory });

    new pcf.MultiRelationshipNode(this, {
      key: "ComponentConnectsToComponent",
      dmo: relationships.ComponentConnectsToComponent,
      source: component,
      target: component,
    });

    new pcf.MultiRelatedElementNode(this, {
      key: "ComponentAssemblesComponents",
      dmo: relatedElements.ComponentAssemblesComponents,
      source: component,
      target: component,
    });
  }
}

export default new <%= className %>();

