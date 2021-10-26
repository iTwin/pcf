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
    iModelId: "46e97028-a81f-4082-b2fa-2e5ed1f38e32",
    clientConfig: { 
      clientId: "spa-oGVHJyqrqU61ooywdsHiyIBBJ",
      redirectUri: "http://localhost:3000/signin-callback",
      scope: "openid projects:modify users:read itwinjs email organization profile projects:read",
      issuerUrl: "https://qa-ims.bentley.com",
    },
    urlPrefix: pcf.ReqURLPrefix.QA,
  });
  const app = new pcf.BaseApp(jobArgs, hubArgs);
  await app.run();
}

main();

