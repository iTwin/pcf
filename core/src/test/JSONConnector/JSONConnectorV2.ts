import { PrimitiveType } from "@bentley/ecschema-metadata";
import JSONConnector from "./JSONConnector";
import * as pcf from "../../pcf";

export function getBridgeInstance() {
  const connector = new JSONConnector();
  connector.tree.models.forEach((model: pcf.ModelNode) => {

    // delete a category manually
    model.elements = model.elements.filter((node: pcf.Node) => node.key !== "SpatialCategory2")

    // add a new dynamic property
    model.elements.forEach((elementNode: pcf.Node) => {
      if (elementNode.key === "ExtPhysicalElement") {
        const dmo = (elementNode as pcf.MultiElementNode).dmo as pcf.ElementDMO;
        if (dmo.classProps) {
          (dmo.classProps as any).properties.push({
            name: "SkyScraperNumber",
            type: PrimitiveType.String,
          });
        }
      }
    });

  });
  return connector;
}
