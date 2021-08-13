
// App.ts contains all the parameters to start a connector job and the App.js created from this file will be the executable for your connector.
// CAUTION: You may not want to commit this file as it contains client-specific info.

import * as pcf from "@itwin/pcf";
import * as path from "path";

export async function main() {
  // define job specific arguments
  const jobArgs = new pcf.JobArgs({
    connectorPath: path.join(__dirname, "<%= className %>.js"),
    // references an existing subject node defined in <%= className %>.ts
    subjectKey: "sample-subject-1",
    connection: {
      // references an existing loader defined in <%= className %>.ts 
      loaderKey: "sample-xlsx-loader",
      kind: "pcf_file_connection",
      filepath: path.join(__dirname, "../assets/sample.xlsx"),
    },
  });
  // define iModel Hub information
  const hubArgs = new pcf.HubArgs({
    projectId: "<Your Project ID Guid>",
    iModelId: "<Your iModel ID Guid>",
    // You must register your own SPA client app and use its client ID (see https://developer.bentley.com)
    clientConfig: {
      clientId: "<%= clientId %>",
      redirectUri: "<%= clientRedirectUri %>",
      scope: "<%= clientScope %>",
    },
  });
  const app = new pcf.BaseApp(jobArgs, hubArgs);
  await app.run();
}

main();

