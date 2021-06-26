import * as bk from "@bentley/imodeljs-backend";
import * as chai from "chai";
import * as path from "path";
import * as fs from "fs";
import * as pcf from "../../pcf";
import KnownTestLocations from "../KnownTestLocations";
import TestResults from "../ExpectedTestResults";
import { JSONLoader, SQLiteLoader } from "../../loaders";
import { PConnector } from "../../PConnector";
import * as utils from "../../Utils";

describe("Unit Tests", () => {

  const testCases: any = [
    {
      title: "Should create empty snapshotDb and synchronize source data (JSON)",
      sourceFiles: ["v1.json", "v2.json"],
      connectorFiles: ["JSONConnector.js", "JSONConnectorV2.js"],
    },
  ];

  before(async () => {
    await bk.IModelHost.startup();
    if (!fs.existsSync(KnownTestLocations.testOutputDir))
      fs.mkdirSync(KnownTestLocations.testOutputDir);
  });

  after(async () => {
    await bk.IModelHost.shutdown();
  });

  const jobArgs = new pcf.JobArgs({
    connectorPath: path.join(KnownTestLocations.JSONConnectorDir, "JSONConnector.js"),
    connection: { kind: "pcf_file_connection", filepath: path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json") },
    loaderClass: JSONLoader,
  });

  const tempSrcPath = path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json");
  const targetPath = path.join(KnownTestLocations.testOutputDir, `${path.basename(tempSrcPath, path.extname(tempSrcPath))}.bim`);

  for (const testCase of testCases) {
    it(testCase.title, async () => {
      if (fs.existsSync(targetPath))
        fs.unlinkSync(targetPath);

      bk.StandaloneDb.createEmpty(targetPath, { rootSubject: { name: "TestRootSubject" } }).close();

      for (let i = 0; i < testCase.sourceFiles.length; i++) {
        const srcFile = testCase.sourceFiles[i];
        const srcPath = path.join(KnownTestLocations.testAssetsDir, testCase.sourceFiles[i]);
        bk.IModelJsFs.copySync(srcPath, tempSrcPath, { overwrite: true });

        const connectorPath = path.join(KnownTestLocations.JSONConnectorDir, testCase.connectorFiles[i]);
        jobArgs.connectorPath = connectorPath;

        const db = bk.StandaloneDb.openFile(targetPath);

        const connector: PConnector = require(jobArgs.connectorPath).default();
        connector.init({ db, jobArgs });
        await connector.runJob();
        db.close();

        const updatedDb = bk.StandaloneDb.openFile(targetPath);
        const mismatches = await pcf.verifyIModel(updatedDb, TestResults[srcFile]);
        updatedDb.close();
        if (mismatches.length > 0)
          chai.assert.fail(`verifyIModel failed. See mismatches: ${JSON.stringify(mismatches, null, 4)}`);
      }

      fs.unlinkSync(targetPath);
    });
  }

  it("Loader Tests", async () => {
    const connector: PConnector = require(jobArgs.connectorPath).default();
    const config = connector.config.loader;

    const jsonLoader = new JSONLoader({ kind: "pcf_file_connection", filepath: path.join(KnownTestLocations.testAssetsDir, "v1.json")}, config);
    await jsonLoader.open();
    const modelFromJSON = await pcf.IRModel.fromLoader(jsonLoader);
    await jsonLoader.close();

    const sqliteLoader = new SQLiteLoader({ kind: "pcf_file_connection", filepath: path.join(KnownTestLocations.testAssetsDir, "v1.sqlite")}, config);
    await sqliteLoader.open();
    const modelFromSQLite = await pcf.IRModel.fromLoader(sqliteLoader);
    await sqliteLoader.close();

    if (!pcf.IRModel.compare(modelFromJSON, modelFromSQLite))
      chai.assert.fail("IR Model from JSON != IR Model from SQLite");
  });
});
