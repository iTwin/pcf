/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import * as path from "path";
import * as pcf from "../../pcf";
import { LogLevel } from "@bentley/bentleyjs-core";

export async function main() {
  const jobArgs = new pcf.JobArgs({ 
    connectorPath: path.join(__dirname, "JSONConnector"),
    subjectKey: "Subject1",
    connection: {
      loaderKey: "json-loader-1",
      kind: "pcf_file_connection",
      filepath: path.join(__dirname, "../assets/v1.json"),
    },
    logLevel: LogLevel.Info,
  });
  const hubArgs = new pcf.HubArgs({
    projectId: "cef2040d-651e-4307-8b2a-dac0b44fbf7f", 
    iModelId: "b4e9902b-0839-43d3-a409-cc1f37db9a49",
    clientConfig: { 
      clientId: "",
      redirectUri: "http://localhost:3000/signin-callback",
      scope: "connections:read connections:modify realitydata:read imodels:read imodels:modify library:read storage:read storage:modify openid email profile organization imodelhub context-registry-service:read-only product-settings-service general-purpose-imodeljs-backend imodeljs-router urlps-third-party projectwise-share rbac-user:external-client projects:read projects:modify validation:read validation:modify issues:read issues:modify forms:read forms:modify",
    },
    env: pcf.Environment.QA,
  });
  const app = new pcf.BaseApp(jobArgs, hubArgs);
  await app.run();
}

main();

