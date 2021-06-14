
// App.ts contains all the parameters to start a connector job and the App.js created from this file will be the executable for your connector.
// CAUTION: You may not want to commit this file as it contains client-specific info.

import * as bk from "@bentley/imodeljs-backend";
import * as pcf from "@itwin/pcf";
import * as path from "path";

async function run() {
  await bk.IModelHost.startup();
  const config: pcf.BaseAppConfig = {
    // You must register your own client app and use its client ID (see https://developer.bentley.com)
    clientConfig: {
      clientId: "<%= clientId %>",
      redirectUri: "<%= clientRedirectUri %>",
      scope: "<%= clientScope %>",
    },
    connectorModule: path.join(__dirname, "<%= className %>.js"),
    outputDir: path.join(__dirname, "./output"),
    sourcePath: path.join(__dirname, "./assets/COBieV1.xlsx"),
    projectId: "<Your Project ID Guid>",
    iModelId: "<Your iModel ID Guid>",
  }
  const app = new pcf.BaseApp(config);
  await app.run();
  await bk.IModelHost.shutdown();
}

run();

