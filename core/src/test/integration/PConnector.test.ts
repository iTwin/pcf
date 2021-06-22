import * as bk from "@bentley/imodeljs-backend";
import * as chai from "chai";
import * as path from "path";
import * as fs from "fs";
import KnownTestLocations from "../KnownTestLocations";
import TestResults from "../ExpectedTestResults";
import TestLoaderConfig from "../TestLoaderConfig";
import * as pcf from "../../pcf";
import { JSONLoader } from "../../drivers";

describe("Integration Tests", () => {

  const testCases = [
    {
      title: "Should synchronize both external and internal elements.",
      sourceFiles: ["v1.json", "v2.json"],
      connectorFiles: ["JSONConnector.js", "JSONConnectorV2.js"],
    },
  ]

  const testHubArgs = new pcf.TestHubArgs({
    projectId: "cef2040d-651e-4307-8b2a-dac0b44fbf7f",
    iModelId: "85ac8276-9d4a-478c-82af-55c832c7da3a", // dummy value not used
    clientConfig: {
      clientId: "spa-aXwJXSgbRU2BZLfsQHL2bc9Vb",
      redirectUri: "http://localhost:3000/signin-callback",
      scope: "connections:read connections:modify realitydata:read imodels:read imodels:modify library:read storage:read storage:modify openid email profile organization imodelhub context-registry-service:read-only product-settings-service general-purpose-imodeljs-backend imodeljs-router urlps-third-party projectwise-share rbac-user:external-client projects:read projects:modify validation:read validation:modify issues:read issues:modify forms:read forms:modify",
    },
  });

  const testJobArgs = new pcf.JobArgs({
    connectorPath: path.join(__dirname, "JSONConnector.js"),
    con: { kind: "FileConnection", filepath: path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json") },
  });

  const app = new pcf.IntegrationTestApp(testJobArgs, testHubArgs);

  before(async () => {
    await bk.IModelHost.startup();
    if (!fs.existsSync(KnownTestLocations.testOutputDir))
      fs.mkdirSync(KnownTestLocations.testOutputDir);
    await app.signin();
  });

  for (const testCase of testCases) {
    it(testCase.title, async () => {
      try {
        await app.createTestBriefcaseDb();
        for (let i = 0; i < testCase.sourceFiles.length; i++) {
          const srcFile = testCase.sourceFiles[i];
          const srcPath = path.join(KnownTestLocations.testAssetsDir, srcFile);
          fs.copyFileSync(srcPath, app.jobArgs.con.filepath);

          const db = await app.openTestBriefcaseDb();
          const connectorPath = path.join(KnownTestLocations.JSONConnectorDir, testCase.connectorFiles[i]);
          app.jobArgs.connectorPath = connectorPath;
          
          const loader = new JSONLoader(app.jobArgs.con, TestLoaderConfig);
          await app.run(db, loader);

          const updatedDb = await app.openTestBriefcaseDb();
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
