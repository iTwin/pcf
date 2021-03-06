
// App.ts contains all the parameters to start a connector job and the App.js created from this file will be the executable for your connector.
// CAUTION: You may not want to commit this file as it contains client-specific info.

import * as pcf from "@itwin/pcf";
import * as path from "path";

export async function main() {
  // define job specific arguments
  const jobArgs = new pcf.JobArgs({
    connectorPath: path.join(__dirname, "<%= className %>.js"),
    // references an existing SubjectNode defined in <%= className %>.ts
    subjectNodeKey: "sample-subject-1",
    connection: {
      // references an existing LoaderNode defined in <%= className %>.ts 
      loaderNodeKey: "sample-xlsx-loader",
      kind: "pcf_file_connection",
      filepath: path.join(__dirname, "../assets/sample.xlsx"),
    },
  });
  // define iModel Hub information
  const hubArgs = new pcf.HubArgs({
    projectId: "<%= projectId %>",
    iModelId: "<%= iModelId %>",
    // You must register your own SPA client app and use its client ID (see https://developer.bentley.com)
    clientConfig: {
      clientId: "<%= clientId %>",
      redirectUri: "<%= clientRedirectUri %>",
      scope: "<%= clientScope %>",
    },
  });
  const app = new pcf.BaseApp(hubArgs);
  await app.runConnectorJob(jobArgs);
}

main();

