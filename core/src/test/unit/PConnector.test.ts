/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { Logger, LogLevel } from "@itwin/core-bentley";
import { IModelHost, StandaloneDb } from "@itwin/core-backend";
import * as chai from "chai";
import * as path from "path";
import * as fs from "fs";
import * as pcf from "../../pcf";
import KnownTestLocations from "../KnownTestLocations";
import TestResults from "../ExpectedTestResults";

describe("Unit Tests", () => {

  const tempSrcPath = path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json");

  const testCases = [
    {
      title: "synchronize StandaloneDb",
      jobs: [
        {
          sourceFile: "v1.json",
          connectorFile: "JSONConnector.js",
          subjectNodeKey: "Subject1",
          connection: {
            loaderNodeKey: "json-loader-1",
            kind: "pcf_file_connection",
            filepath: tempSrcPath,
          }
        },
        {
          sourceFile: "v2.json",
          connectorFile: "JSONConnectorV2.js",
          subjectNodeKey: "Subject1",
          connection: {
            loaderNodeKey: "json-loader-1",
            kind: "pcf_file_connection",
            filepath: tempSrcPath,
          }
        },
      ]
    },
  ]

  const targetPath = path.join(KnownTestLocations.testOutputDir, `${path.basename(tempSrcPath, path.extname(tempSrcPath))}.bim`);

  before(async () => {
    await IModelHost.startup();
    if (!fs.existsSync(KnownTestLocations.testOutputDir))
      fs.mkdirSync(KnownTestLocations.testOutputDir);
    Logger.initializeToConsole();
    Logger.configureLevels({
      categoryLevels: [
        {
          category: pcf.LogCategory.PCF,
          logLevel: LogLevel[LogLevel.Trace],
        },
      ]
    });
  });

  after(async () => {
    await IModelHost.shutdown();

    if (fs.existsSync(tempSrcPath))
      fs.unlinkSync(tempSrcPath);

    if (fs.existsSync(targetPath))
      fs.unlinkSync(targetPath);
  });

  for (const testCase of testCases) {
    it(testCase.title, async () => {
      if (fs.existsSync(targetPath))
        fs.unlinkSync(targetPath);

      StandaloneDb.createEmpty(targetPath, { rootSubject: { name: "TestRootSubject" } }).close();

      for (const job of testCase.jobs) {
        const { subjectNodeKey, sourceFile, connection, connectorFile } = job;
        const connectorPath = path.join(KnownTestLocations.JSONConnectorDir, connectorFile);

        const sourcePath = path.join(KnownTestLocations.testAssetsDir, sourceFile);
        const newData = fs.readFileSync(sourcePath);
        fs.writeFileSync(tempSrcPath, newData);

        const db = StandaloneDb.openFile(targetPath);
        const testJobArgs = new pcf.JobArgs({
          subjectNodeKey,
          connectorPath,
          connection,
          logLevel: LogLevel.Trace,
        } as pcf.JobArgsProps);

        const connector: pcf.PConnector = await require(testJobArgs.connectorPath).getConnectorInstance();
        await connector.runJobUnsafe(db, testJobArgs);
        db.close();

        const updatedDb = StandaloneDb.openFile(targetPath);
        const mismatches = await pcf.verifyIModel(updatedDb, TestResults[sourceFile]);
        updatedDb.close();
        if (mismatches.length > 0)
          chai.assert.fail(`verifyIModel failed. See mismatches: ${JSON.stringify(mismatches, null, 4)}`);
      }
    });
  }

  it("Loader Tests", async () => {
    const props: pcf.LoaderProps = {
      format: "json",
      entities: ["ExtPhysicalElement", "ExtPhysicalType", "ExtGroupInformationElement", "ExtSpace", "ExtSpatialCategory"],
      relationships: ["ExtElementRefersToElements", "ExtElementRefersToExistingElements", "ExtElementGroupsMembers", "ExtPhysicalElementAssemblesElements"],
      defaultPrimaryKey: "id",
    };

    const jsonLoader = new pcf.JSONLoader(props);
    const jsonConnection = { kind: "pcf_file_connection", filepath: path.join(KnownTestLocations.testAssetsDir, "v1.json") };
    const modelFromJSON = new pcf.IRModel(jsonLoader, jsonConnection as pcf.DataConnection)
    await modelFromJSON.load();

    const sqliteLoader = new pcf.SQLiteLoader(props);
    const sqliteConnection = { kind: "pcf_file_connection", filepath: path.join(KnownTestLocations.testAssetsDir, "v1.sqlite") };
    const modelFromSQLite = new pcf.IRModel(sqliteLoader, sqliteConnection as pcf.DataConnection);
    await modelFromSQLite.load();

    if (!pcf.IRModel.compare(modelFromJSON, modelFromSQLite))
      chai.assert.fail("IR Model from JSON != IR Model from SQLite");

    await modelFromJSON.clear();
    await modelFromSQLite.clear();
  });
});

