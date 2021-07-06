import { PrimitiveType } from "@bentley/ecschema-metadata";
import * as pcf from "../../pcf";

const connectorV2 = (() => {
  const connector = require("./JSONConnector").default();
  const subjectNode = connector.tree.getSubjectNode("Subject1");
  subjectNode.models.forEach((model: pcf.ModelNode) => {
    // add a new dynamic property
    model.elements.forEach((elementNode: pcf.Node) => {
      if (elementNode.key === "ExtPhysicalElement") {
        const dmo = (elementNode as pcf.ElementNode).dmo as pcf.ElementDMO;
        if (dmo.ecElement && typeof dmo.ecElement !== "string") {
          (dmo.ecElement as any).properties.push({
            name: "SkyScraperNumber",
            type: PrimitiveType.String,
          });
        }
      }
    });
  });
  return connector;
})();

export function getBridgeInstance() {
  return connectorV2;
}

export default () => connectorV2;
