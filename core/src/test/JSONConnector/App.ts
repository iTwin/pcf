/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as pcf from "../../pcf";

import { LogLevel } from "@itwin/core-bentley";

export async function main() {
  const jobArgs = new pcf.JobArgs({
    connectorPath: path.join(__dirname, "JSONConnector"),
    subjectNodeKey: "Subject1",
    connection: {
      loaderNodeKey: "json-loader-1",
      kind: "pcf_file_connection",
      filepath: path.join(__dirname, "../assets/v1.json"),
    },
  });
  const hubArgs = new pcf.HubArgs({
    projectId: "cef2040d-651e-4307-8b2a-dac0b44fbf7f",
    iModelId: "e3da2033-d815-4970-aed0-80b0d3d1050b",
    clientConfig: {
      clientId: process.env.imjs_test_client_id as string,
      redirectUri: "http://localhost:3000",
      scope: "imodels:modify imodels:read"
    },
    urlPrefix: pcf.ReqURLPrefix.QA,
  });
  const app = new pcf.BaseApp(hubArgs, LogLevel.Trace);
  await app.runConnectorJob(jobArgs);
}

main();
