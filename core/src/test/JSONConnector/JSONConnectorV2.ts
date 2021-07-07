import { PrimitiveType } from "@bentley/ecschema-metadata";
import { JSONConnector } from "./JSONConnector";
import * as pcf from "../../pcf";

export function getBridgeInstance() {
  const connector = new JSONConnector();
  const subjectNode = connector.tree.getSubjectNode("Subject1");
  subjectNode.models.forEach((model: pcf.ModelNode) => {
    // add a new dynamic property
    model.elements.forEach((elementNode: pcf.ElementNode) => {
      if (elementNode.key === "ExtPhysicalElement") {
        const dmoCopy = JSON.parse(JSON.stringify(elementNode.dmo));
        if (dmoCopy.ecElement && typeof dmoCopy.ecElement !== "string") {
          (dmoCopy.ecElement as any).properties.push({
            name: "SkyScraperNumber",
            type: PrimitiveType.String,
          });
        }
        elementNode.dmo = dmoCopy;
      }
    });
  });
  return connector;
}
