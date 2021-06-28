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
    });

    const jsonLoader = new pcf.XLSXLoader(this, {
      key: "json-loader-1",
      format: "json",
      entityKeys: ["Component", "ComponentCategory"],
      relKeys: ["Connection", "Assembly"],
    });

    const subject1 = new pcf.SubjectNode(this, { key: "sample-subject-1" });

    const defModel = new pcf.ModelNode(this, { key: "DefinitionModel1", subject: subject1, bisClass: bk.DefinitionModel, partitionClass: bk.DefinitionPartition });
    const phyModel = new pcf.ModelNode(this, { key: "PhysicalModel1", subject: subject1, bisClass: bk.PhysicalModel, partitionClass: bk.PhysicalPartition });
    const sptCategory = new pcf.ElementNode(this, { key: "SpatialCategory1", model: defModel, dmo: elements.ComponentCategory });
    const component = new pcf.ElementNode(this, { key: "Component", model: phyModel, dmo: elements.Component, category: sptCategory });

    new pcf.RelationshipNode(this, {
      key: "ComponentConnectsToComponent",
      dmo: relationships.ComponentConnectsToComponent,
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

export default new <%= className %>();

