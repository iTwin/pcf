/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { BentleyStatus } from "@bentley/bentleyjs-core";
import * as bk from "@bentley/imodeljs-backend";
import KnownTestLocations from "../KnownTestLocations";
import TestResults from "../ExpectedTestResults";
import * as pcf from "../../pcf";
import { IntegrationTestApp } from "./IntegrationTestApp";
import * as chai from "chai";
import * as path from "path";
import * as fs from "fs";

describe("Integration Tests", () => {

  enum RunMethods {
    WithoutFwk = "WithoutFwk",
    WithFwk = "WithFwk",
  }

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
        {
          sourceFile: "v3.json",
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
  const app = new IntegrationTestApp({ connectorPath: testConnectorPath, connection: testConnection } as pcf.JobArgs);

  before(async () => {
    if (!fs.existsSync(KnownTestLocations.testOutputDir))
      fs.mkdirSync(KnownTestLocations.testOutputDir);
    await app.silentSignin();
  });

  after(async () => {
    if (app.hubArgs.iModelId !== "")
      await app.purgeTestBriefcaseDb();
  });

  for (const testCase of testCases) {
    for (const method of [RunMethods.WithoutFwk /*, RunMethods.WithFwk*/]) {
      it(`${method} - ${testCase.title}`, async () => {
        await app.createTestBriefcaseDb("app.run Integration Test");
        for (const job of testCase.jobs) {
          const { subjectKey, sourceFile, connection, connectorFile } = job;
          const connectorPath = path.join(KnownTestLocations.JSONConnectorDir, connectorFile);

          const sourcePath = path.join(KnownTestLocations.testAssetsDir, sourceFile);
          const newData = fs.readFileSync(sourcePath);
          fs.writeFileSync(app.jobArgs.connection.filepath, newData);

          app.jobArgs = new pcf.JobArgs({ subjectKey, connectorPath, connection } as pcf.JobArgsProps);

          let status: BentleyStatus;
          if (method === RunMethods.WithoutFwk)
            status = await app.run();
          else if (method === RunMethods.WithFwk)
            status = await app.runFwk();
          else
            throw new Error("Unknown RunMethod");

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
  }
});

