import { LogLevel } from "@bentley/bentleyjs-core";
import { KnownTestLocations } from "../KnownTestLocations";
import { TestResults } from "../ExpectedTestResults";
import * as pcf from "../../pcf";
import * as path from "path";
import * as fs from "fs";

describe("Integration Tests", () => {

  const testCases = [
    {
      title: "Should synchronize both external and internal elements.",
      sourceFiles: ["v1.json", "v2.json"],
      connectorModules: ["JSONConnector.js", "JSONConnectorV2.js"]
    },
  ]

  const params: pcf.BaseTestAppConfig = {
    clientConfig: {
      clientId: "spa-K0UnSwsqlvodyNS5sYnPgyNgu",
      redirectUri: "http://localhost:3000/signin-callback",
      scope: "connections:read connections:modify realitydata:read imodels:read imodels:modify library:read storage:read storage:modify openid email profile organization imodelhub context-registry-service:read-only product-settings-service general-purpose-imodeljs-backend imodeljs-router urlps-third-party projectwise-share rbac-user:external-client projects:read projects:modify validation:read validation:modify issues:read issues:modify forms:read forms:modify",
    },
    outputDir: path.join(KnownTestLocations.JSONConnectorDir, "output"),
    sourcePath: path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json"),
    projectId: "cef2040d-651e-4307-8b2a-dac0b44fbf7f",
    logLevel: LogLevel.None, // LogLevel.Error
  }

  const app = new pcf.BaseTestApp(params);
  let briefcase;

  before(async () => {
    if (!fs.existsSync(KnownTestLocations.testOutputDir))
      fs.mkdirSync(KnownTestLocations.testOutputDir);
    await app.startup();
    await app.signin();
  });

  for (const testCase of testCases) {
    it(testCase.title, async () => {
      try {
        await app.createTestIModel();
        for (let i = 0; i < testCase.sourceFiles.length; i++) {
          const srcFile = testCase.sourceFiles[i];
          const connectorModule = testCase.connectorModules[i];
          const srcPath = path.join(KnownTestLocations.testAssetsDir, srcFile);
          fs.copyFileSync(srcPath, app.jobArgs.sourcePath!);

          app.jobArgs.bridgeModule = path.join(KnownTestLocations.JSONConnectorDir, connectorModule);

          await app.sync();
          await new Promise((r: any) => setTimeout(r, 30 * 1000));

          briefcase = await app.openBriefcase();
          await pcf.verifyIModel(briefcase, TestResults[srcFile]);
          briefcase.close();
        }
      } finally {
        await app.purgeTestIModel();
        await app.shutdown();
      }
    });
  }
});
