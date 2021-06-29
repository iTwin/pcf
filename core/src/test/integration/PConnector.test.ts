import * as bk from "@bentley/imodeljs-backend";
import * as chai from "chai";
import * as path from "path";
import * as fs from "fs";
import KnownTestLocations from "../KnownTestLocations";
import TestResults from "../ExpectedTestResults";
import * as pcf from "../../pcf";
import { BentleyStatus } from "@bentley/bentleyjs-core";
import { JobArgs, JobArgsProps } from "../../pcf";

describe("Integration Tests", () => {

  const testCases = [
    {
      title: "synchronize BriefcaseDb",
      jobs: [
        {
          sourceFile: "v1.json",
          connectorFile: "JSONConnector.js",
          subjectKey: "Subject1",
          connection: {
            loaderKey: "json-loader-1",
            kind: "pcf_file_connection",
            filepath: path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json")
          }
        },
        {
          sourceFile: "v2.json",
          connectorFile: "JSONConnectorV2.js",
          subjectKey: "Subject1",
          connection: {
            loaderKey: "json-loader-1",
            kind: "pcf_file_connection",
            filepath: path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json")
          }
        },
      ]
    },
  ]

  const testConnection = testCases[0].jobs[0].connection;
  const testConnectorPath = path.join(KnownTestLocations.JSONConnectorDir, testCases[0].jobs[0].connectorFile);
  const app = new pcf.IntegrationTestApp({ connectorPath: testConnectorPath, connection: testConnection } as JobArgs);

  before(async () => {
    await bk.IModelHost.startup();
    if (!fs.existsSync(KnownTestLocations.testOutputDir))
      fs.mkdirSync(KnownTestLocations.testOutputDir);
    await app.silentSignin();
  });

  after(async () => {
    if (app.hubArgs.iModelId !== "")
      await app.purgeTestBriefcaseDb();
    await bk.IModelHost.shutdown();
  });

  for (const testCase of testCases) {
    it(testCase.title, async () => {
      await app.createTestBriefcaseDb();
      for (const job of testCase.jobs) {
        const { subjectKey, sourceFile, connection, connectorFile } = job;
        const connectorPath = path.join(KnownTestLocations.JSONConnectorDir, connectorFile);

        const sourcePath = path.join(KnownTestLocations.testAssetsDir, sourceFile);
        fs.copyFileSync(sourcePath, app.jobArgs.connection.filepath);

        app.jobArgs = new pcf.JobArgs({ subjectKey, connectorPath, connection } as JobArgsProps);

        const status = await app.run();
        if (status !== BentleyStatus.SUCCESS)
          chai.assert.fail("app run failed");

        const updatedDb = await app.openBriefcaseDb();
        const mismatches = await pcf.verifyIModel(updatedDb, TestResults[sourceFile]);
        updatedDb.close();
        if (mismatches.length > 0)
          chai.assert.fail(`verifyIModel failed. See mismatches: ${JSON.stringify(mismatches, null, 4)}`);
      }
    });
  }
});

