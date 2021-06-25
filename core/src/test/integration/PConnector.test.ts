import * as bk from "@bentley/imodeljs-backend";
import * as chai from "chai";
import * as path from "path";
import * as fs from "fs";
import KnownTestLocations from "../KnownTestLocations";
import TestResults from "../ExpectedTestResults";
import * as pcf from "../../pcf";
import { JSONLoader } from "../../loaders";
import { BentleyStatus } from "@bentley/bentleyjs-core";

describe("Integration Tests", () => {

  const testCases = [
    {
      title: "Should synchronize both external and internal elements.",
      sourceFiles: ["v1.json", "v2.json"],
      connectorFiles: ["JSONConnector.js", "JSONConnectorV2.js"],
    },
  ]

  const testJobArgs = new pcf.JobArgs({
    connectorPath: path.join(__dirname, "JSONConnector.js"),
    connection: { kind: "FileConnection", filepath: path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json") },
    loaderClass: JSONLoader,
  });

  const app = new pcf.IntegrationTestApp(testJobArgs);

  before(async () => {
    await bk.IModelHost.startup();
    if (!fs.existsSync(KnownTestLocations.testOutputDir))
      fs.mkdirSync(KnownTestLocations.testOutputDir);
    await app.signin();
  });

  after(async () => {
connection   if (app.hubArgs.iModelId !== "")
      await app.purgeTestBriefcaseDb();
    await bk.IModelHost.shutdown();
  });

  for (const testCase of testCases) {
    it(testCase.title, async () => {
      await app.createTestBriefcaseDb();
      for (let i = 0; i < testCase.sourceFiles.length; i++) {
        const srcFile = testCase.sourceFiles[i];
        const srcPath = path.join(KnownTestLocations.testAssetsDir, srcFile);
        fs.copyFileSync(srcPath, app.jobArgs.con.filepath);
        const connectorPath = path.join(KnownTestLocations.JSONConnectorDir, testCase.connectorFiles[i]);
        app.jobArgs.connectorPath = connectorPath;

        const status = await app.run();
        if (status !== BentleyStatus.SUCCESS)
          chai.assert.fail("app run failed");

        const updatedDb = await app.openBriefcaseDb();
        const mismatches = await pcf.verifyIModel(updatedDb, TestResults[srcFile]);
        updatedDb.close();
        if (mismatches.length > 0)
          chai.assert.fail(`verifyIModel failed. See mismatches: ${JSON.stringify(mismatches, null, 4)}`);
      }
    });
  }
});
