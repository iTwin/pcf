/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { IModelHost } from "@itwin/core-backend";
import KnownTestLocations from "../KnownTestLocations";
import TestResults from "../ExpectedTestResults";
import { IntegrationTestApp } from "./IntegrationTestApp";
import * as pcf from "../../pcf";
import * as chai from "chai";
import * as path from "path";
import * as fs from "fs";

describe("Integration Tests", () => {

  // not used for now
  enum RunMethods {
    WithoutFwk = "WithoutFwk",
    WithFwk = "WithFwk",
  }

  const testCases = [
    {
      title: "Synchronize iModel",
      jobs: [
        // Start from an empty iModel
        {
          sourceFile: "v1.json",
          connectorFile: "JSONConnector.js",
          subjectNodeKey: "Subject1",
          connection: {
            loaderNodeKey: "json-loader-1",
            kind: "pcf_file_connection",
            filepath: path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json")
          }
        },
        // Update an iModel
        {
          sourceFile: "v2.json",
          connectorFile: "JSONConnectorV2.js",
          subjectNodeKey: "Subject1",
          connection: {
            loaderNodeKey: "json-loader-1",
            kind: "pcf_file_connection",
            filepath: path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json")
          }
        },
        // Reuse Code
        {
          sourceFile: "v3.json",
          connectorFile: "JSONConnectorV2.js",
          subjectNodeKey: "Subject1",
          connection: {
            loaderNodeKey: "json-loader-1",
            kind: "pcf_file_connection",
            filepath: path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json")
          }
        },
        // ElementAspect deletion
        {
          sourceFile: "v4.json",
          connectorFile: "JSONConnectorV2.js",
          subjectNodeKey: "Subject1",
          connection: {
            loaderNodeKey: "json-loader-1",
            kind: "pcf_file_connection",
            filepath: path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json")
          }
        },
        // Working in a new Subject
        {
          sourceFile: "v5.json",
          connectorFile: "JSONConnectorV2.js",
          subjectNodeKey: "Subject2",
          connection: {
            loaderNodeKey: "api-loader-1",
            kind: "pcf_api_connection",
            baseUrl: "test.com",
          }
        },
      ]
    },
  ];

  const app = new IntegrationTestApp();

  before(async () => {
    if (!fs.existsSync(KnownTestLocations.testOutputDir))
      fs.mkdirSync(KnownTestLocations.testOutputDir);
    await IModelHost.startup();
    await app.signin();
  });

  after(async () => {
    if (app.hubArgs.iModelId !== "")
      await app.purgeTestBriefcaseDb();
    await IModelHost.shutdown();
  });

  for (const testCase of testCases) {
    it(testCase.title, async () => {
      await app.createTestBriefcaseDb("PCF-Integration-Test");
      for (const job of testCase.jobs) {

        const { subjectNodeKey, sourceFile, connection, connectorFile } = job;
        const connectorPath = path.join(KnownTestLocations.JSONConnectorDir, connectorFile);

        const sourcePath = path.join(KnownTestLocations.testAssetsDir, sourceFile);
        const newData = fs.readFileSync(sourcePath);
        if (connection.filepath)
          fs.writeFileSync(connection.filepath, newData);

        const jobArgs = new pcf.JobArgs({
          subjectNodeKey,
          sourceFile,
          connectorPath,
          connection,
          interactiveSignin: false,
        } as pcf.JobArgsProps);

        const success = await app.runConnectorJob(jobArgs);
        if (!success)
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

