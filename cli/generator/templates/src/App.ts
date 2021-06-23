
// App.ts contains all the parameters to start a connector job and the App.js created from this file will be the executable for your connector.
// CAUTION: You may not want to commit this file as it contains client-specific info.

import * as bk from "@bentley/imodeljs-backend";
import * as pcf from "@itwin/pcf";
import * as path from "path";

export async function main() {
  await bk.IModelHost.startup();
  const jobArgs = new pcf.JobArgs({
    connectorPath: path.join(__dirname, "<%= className %>.js"),
    loaderClass: pcf.XLSXLoader,
    con: {
      kind: "FileConnection",
      filepath: path.join(__dirname, "./assets/COBieV1.xlsx"),
    },
  });
  const hubArgs = new pcf.HubArgs({
    projectId: "<Your Project ID Guid>",
    iModelId: "<Your iModel ID Guid>",
    // You must register your own client app and use its client ID (see https://developer.bentley.com)
    clientConfig: {
      clientId: "<%= clientId %>",
      redirectUri: "<%= clientRedirectUri %>",
      scope: "<%= clientScope %>",
    },
  });
  const app = new pcf.BaseApp(jobArgs, hubArgs);
  await app.run();
  await bk.IModelHost.shutdown();
}

main();

