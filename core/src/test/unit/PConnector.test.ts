/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { Logger, LogLevel } from "@bentley/bentleyjs-core";
import * as bk from "@bentley/imodeljs-backend";
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
          subjectKey: "Subject1",
          connection: {
            loaderKey: "json-loader-1",
            kind: "pcf_file_connection",
            filepath: tempSrcPath,
          }
        },
        {
          sourceFile: "v2.json",
          connectorFile: "JSONConnectorV2.js",
          subjectKey: "Subject1",
          connection: {
            loaderKey: "json-loader-1",
            kind: "pcf_file_connection",
            filepath: tempSrcPath,
          }
        },
      ]
    },
  ]

  const targetPath = path.join(KnownTestLocations.testOutputDir, `${path.basename(tempSrcPath, path.extname(tempSrcPath))}.bim`);

  before(async () => {
    await bk.IModelHost.startup();
    Logger.initializeToConsole();
    Logger.configureLevels({
      defaultLevel: LogLevel[LogLevel.None],
      categoryLevels: [
        {
          category: pcf.LogCategory.PCF,
          logLevel: LogLevel[LogLevel.Info],
        },
      ]
    });
    if (!fs.existsSync(KnownTestLocations.testOutputDir))
      fs.mkdirSync(KnownTestLocations.testOutputDir);
  });

  after(async () => {
    await bk.IModelHost.shutdown();

    if (fs.existsSync(tempSrcPath))
      fs.unlinkSync(tempSrcPath);

    if (fs.existsSync(targetPath))
      fs.unlinkSync(targetPath);
  });

  for (const testCase of testCases) {
    it(testCase.title, async () => {
      if (fs.existsSync(targetPath))
        fs.unlinkSync(targetPath);

      bk.StandaloneDb.createEmpty(targetPath, { rootSubject: { name: "TestRootSubject" } }).close();

      for (const job of testCase.jobs) {
        const { subjectKey, sourceFile, connection, connectorFile } = job;
        const connectorPath = path.join(KnownTestLocations.JSONConnectorDir, connectorFile);

        const sourcePath = path.join(KnownTestLocations.testAssetsDir, sourceFile);
        const newData = fs.readFileSync(sourcePath);
        fs.writeFileSync(tempSrcPath, newData);

        const db = bk.StandaloneDb.openFile(targetPath);
        const jobArgs = new pcf.JobArgs({ subjectKey, connectorPath, connection } as pcf.JobArgsProps);
        const connector: pcf.PConnector = require(jobArgs.connectorPath).getBridgeInstance();
        connector.init({ db, jobArgs });
        await connector.runJob();
        db.close();

        const updatedDb = bk.StandaloneDb.openFile(targetPath);
        const mismatches = await pcf.verifyIModel(updatedDb, TestResults[sourceFile]);
        updatedDb.close();
        if (mismatches.length > 0)
          chai.assert.fail(`verifyIModel failed. See mismatches: ${JSON.stringify(mismatches, null, 4)}`);
      }
    });
  }

  it("Loader Tests", async () => {
    const connectorPath = path.join(KnownTestLocations.JSONConnectorDir, "JSONConnector.js");
    const connector: pcf.PConnector = require(connectorPath).getBridgeInstance();

    const props: pcf.LoaderProps = {
      format: "json",
      entities: ["ExtPhysicalElement", "ExtPhysicalType", "ExtGroupInformationElement", "ExtSpace", "ExtSpatialCategory"],
      relationships: ["ExtElementRefersToElements", "ExtElementRefersToExistingElements", "ExtElementGroupsMembers", "ExtPhysicalElementAssemblesElements"],
      defaultPrimaryKey: "id",
    };

    const jsonLoader = new pcf.JSONLoader(props);
    await jsonLoader.open({ kind: "pcf_file_connection", filepath: path.join(KnownTestLocations.testAssetsDir, "v1.json")});
    const modelFromJSON = await pcf.IRModel.fromLoader(jsonLoader);
    await jsonLoader.close();

    const sqliteLoader = new pcf.SQLiteLoader(props);
    await sqliteLoader.open({ kind: "pcf_file_connection", filepath: path.join(KnownTestLocations.testAssetsDir, "v1.sqlite")});
    const modelFromSQLite = await pcf.IRModel.fromLoader(sqliteLoader);
    await sqliteLoader.close();

    if (!pcf.IRModel.compare(modelFromJSON, modelFromSQLite))
      chai.assert.fail("IR Model from JSON != IR Model from SQLite");
  });
});

