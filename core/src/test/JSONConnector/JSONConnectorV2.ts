/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { PrimitiveType } from "@itwin/ecschema-metadata";
import { JSONConnector } from "./JSONConnector";
import * as pcf from "../../pcf";

export async function getBridgeInstance() {
  const connector = new JSONConnector();
  await connector.form();
  const subjectNode = connector.tree.find<pcf.SubjectNode>("Subject1", pcf.SubjectNode);
  subjectNode.models.forEach((model: pcf.ModelNode) => {
    // add a new dynamic property
    model.elements.forEach((node: pcf.Node) => {
      if (node instanceof pcf.ElementNode && node.key === "ExtPhysicalElement") {
        const dmoCopy = JSON.parse(JSON.stringify(node.dmo));
        if (dmoCopy.ecElement && typeof dmoCopy.ecElement !== "string") {
          (dmoCopy.ecElement as any).properties.push({
            name: "SkyScraperNumber",
            type: PrimitiveType.String,
          });
        }
        node.dmo = dmoCopy;
      }
    });
  });
  return connector;
}
