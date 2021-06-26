import { PrimitiveType } from "@bentley/ecschema-metadata";
import * as pcf from "../../pcf";

const connectorV2 = (() => {
  const connector = require("./JSONConnector").default();
  connector.tree.models.forEach((model: pcf.ModelNode) => {
    // add a new dynamic property
    model.elements.forEach((elementNode: pcf.Node) => {
      if (elementNode.key === "ExtPhysicalElement") {
        const dmo = (elementNode as pcf.ElementNode).dmo as pcf.ElementDMO;
        if (dmo.classProps) {
          (dmo.classProps as any).properties.push({
            name: "SkyScraperNumber",
            type: PrimitiveType.String,
          });
        }
      }
    });
  });

  connector.loader.props.sourceKey = "sourceKey1";

  return connector;
})();

export default () => connectorV2;
