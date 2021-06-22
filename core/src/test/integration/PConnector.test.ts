import * as bk from "@bentley/imodeljs-backend";
import * as chai from "chai";
import * as path from "path";
import * as fs from "fs";
import KnownTestLocations from "../KnownTestLocations";
import TestResults from "../ExpectedTestResults";
import * as pcf from "../../pcf";
import { testJSONLoader } from "../TestLoaders";

describe("Integration Tests", () => {

  const testCases = [
    {
      title: "Should synchronize both external and internal elements.",
      sourceFiles: ["v1.json", "v2.json"],
      connectorFiles: ["JSONConnector.js", "JSONConnectorV2.js"],
    },
  ]

  const testHubArgs = new pcf.IntegrationTestArgs({
    projectId: "cef2040d-651e-4307-8b2a-dac0b44fbf7f",
    clientConfig: {
      clientId: "spa-GZnICrOpqnfv9jkaH1MFlri9r",
      redirectUri: "http://localhost:3000/signin-callback",
      scope: "connections:read connections:modify realitydata:read imodels:read imodels:modify library:read storage:read storage:modify openid email profile organization imodelhub context-registry-service:read-only product-settings-service general-purpose-imodeljs-backend imodeljs-router urlps-third-party projectwise-share rbac-user:external-client projects:read projects:modify validation:read validation:modify issues:read issues:modify forms:read forms:modify",
    },
  });

  const testJobArgs = new pcf.JobArgs({
    connectorPath: path.join(__dirname, "JSONConnector.js"),
    dataConnection: { kind: "FileConnection", filepath: path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json") },
  });

  const app = new pcf.IntegrationTestApp(testJobArgs, testHubArgs);

  before(async () => {
    await bk.IModelHost.startup();
    if (!fs.existsSync(KnownTestLocations.testOutputDir))
      fs.mkdirSync(KnownTestLocations.testOutputDir);
    await app.silentSignin();
  });

  for (const testCase of testCases) {
    it(testCase.title, async () => {
      try {
        await app.createTestBriefcaseDb();
        for (let i = 0; i < testCase.sourceFiles.length; i++) {
          const srcFile = testCase.sourceFiles[i];
          const srcPath = path.join(KnownTestLocations.testAssetsDir, srcFile);
          fs.copyFileSync(srcPath, app.jobArgs.dataConnection.filepath);

          const db = await app.downloadTestBriefcaseDb();
          const connectorPath = path.join(KnownTestLocations.JSONConnectorDir, testCase.connectorFiles[i]);
          app.jobArgs.connectorPath = connectorPath;
          await app.run(db, testJSONLoader);
          await new Promise((r: any) => setTimeout(r, 30 * 1000));

          const updatedDb = await app.downloadTestBriefcaseDb();
          await pcf.verifyIModel(updatedDb, TestResults[srcFile]);
          updatedDb.close();
        }
      } catch(err) {
        chai.assert.fail((err as any).toString());
      } finally {
        await app.purgeTestBriefcaseDb();
        await bk.IModelHost.shutdown();
      }
    });
  }
});
