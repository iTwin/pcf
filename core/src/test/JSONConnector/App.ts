import * as bk from "@bentley/imodeljs-backend";
import * as pcf from "../../pcf";
import * as path from "path";

export async function run() {
  await IModelHost.startup();

  const config: pcf.BaseAppConfig = {
    clientConfig: {
      clientId: "spa-K0UnSwsqlvodyNS5sYnPgyNgu",
      redirectUri: "http://localhost:3000/signin-callback",
      scope: "connections:read connections:modify realitydata:read imodels:read imodels:modify library:read storage:read storage:modify openid email profile organization imodelhub context-registry-service:read-only product-settings-service general-purpose-imodeljs-backend imodeljs-router urlps-third-party projectwise-share rbac-user:external-client projects:read projects:modify validation:read validation:modify issues:read issues:modify forms:read forms:modify",
    },
    connectorModule: path.join(__dirname, "JSONConnector.js"),
    outputDir: path.join(__dirname, "output"),
    sourcePath: path.join(__dirname, "../assets/temp.json"),
    projectId: "cef2040d-651e-4307-8b2a-dac0b44fbf7f",
    iModelId: "85ac8276-9d4a-478c-82af-55c832c7da3a",
    env: pcf.Environment.QA,
  }
  const app = new pcf.BaseApp(config);
  await app.run();

  await IModelHost.shutdown();
}

run();

