import * as bk from "@bentley/imodeljs-backend";
import * as path from "path";
import * as pcf from "../../pcf";
import { JSONLoader } from "../../loaders";
import { LogLevel } from "@bentley/bentleyjs-core";

export async function main() {
  await bk.IModelHost.startup();

  const jobArgs = new pcf.JobArgs({ 
    connectorPath: path.join(__dirname, "JSONConnector"),
    connection: {
      kind: "pcf_file_connection",
      filepath: path.join(__dirname, "../assets/temp.json"),
    },
    logLevel: LogLevel.Info,
    loaderClass: JSONLoader,
  });

  const hubArgs = new pcf.HubArgs({
    projectId: "cef2040d-651e-4307-8b2a-dac0b44fbf7f", 
    iModelId: "2f0c6220-3a68-482d-8455-78030edec752",
    clientConfig: { 
      clientId: "spa-aXwJXSgbRU2BZLfsQHL2bc9Vb",
      redirectUri: "http://localhost:3000/signin-callback",
      scope: "connections:read connections:modify realitydata:read imodels:read imodels:modify library:read storage:read storage:modify openid email profile organization imodelhub context-registry-service:read-only product-settings-service general-purpose-imodeljs-backend imodeljs-router urlps-third-party projectwise-share rbac-user:external-client projects:read projects:modify validation:read validation:modify issues:read issues:modify forms:read forms:modify",
    },
    env: pcf.Environment.QA,
  });

  const app = new pcf.BaseApp(jobArgs, hubArgs);
  await app.run();
  await bk.IModelHost.shutdown();
}

main();

