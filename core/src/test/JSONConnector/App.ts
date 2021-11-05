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
    interactiveSignin: false,
  });
  const hubArgs = new pcf.HubArgs({
    projectId: "cef2040d-651e-4307-8b2a-dac0b44fbf7f", 
    iModelId: "9949ce88-97ad-42e8-a3f1-046f8a7a5d22",
    clientConfig: { 
      clientId: process.env.imjs_test_client_id as string,
      clientSecret: process.env.imjs_test_client_secret as string,
      redirectUri: "http://localhost:3000/signin-callback",
      scope: "itwinjs",
    },
    urlPrefix: pcf.ReqURLPrefix.QA,
  });
  const app = new pcf.BaseApp(hubArgs, LogLevel.Trace);
  await app.runConnectorJob(jobArgs);
}

main();

