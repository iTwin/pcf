import { Logger, LogLevel } from "@bentley/bentleyjs-core";
import { IModelHost, IModelJsFs, SnapshotDb } from "@bentley/imodeljs-backend";
import { KnownTestLocations } from "../KnownTestLocations";
import { TestResults } from "../ExpectedTestResults";
import { IRModel } from "../../IRModel";
import { testJSONLoader, testSQLiteLoader } from "../TestLoaders";
import { LogCategory } from "../../LogCategory";
import * as util from "../../Utils";
import JSONConnector from "../JSONConnector/JSONConnector";
import { assert } from "chai";
import * as path from "path";
import * as fs from "fs";
import { App, JobArgs } from "../../BaseApp";

describe("Unit Tests", () => {

  const testCases: any = [
    {
      title: "Should create empty snapshotDb and synchronize source data (JSON)",
      sourceFiles: ["v1.json"],
      connector: new JSONConnector(),
    },
  ];

  before(async () => {
    await IModelHost.startup();
    if (!fs.existsSync(KnownTestLocations.testOutputDir))
      fs.mkdirSync(KnownTestLocations.testOutputDir);
  });

  after(async () => {
    await IModelHost.shutdown();
  });

  const tempSrcPath = path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json");
  const targetPath = path.join(KnownTestLocations.testOutputDir, `${path.basename(tempSrcPath!, path.extname(tempSrcPath!))}.bim`);

  const testJobArgs = new JobArgs({
    dataConnection: { kind: "FileConnection", filepath: path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json") },
  })

  const app = new App(testJobArgs);

  for (const testCase of testCases) {
    it(testCase.title, async () => {
      if (fs.existsSync(targetPath))
        fs.unlinkSync(targetPath);

      SnapshotDb.createEmpty(targetPath, { rootSubject: { name: "TestRootSubject" } }).close();

      for (const srcFile of testCase.sourceFiles) {
        const srcPath = path.join(KnownTestLocations.testAssetsDir, srcFile);
        IModelJsFs.copySync(srcPath, tempSrcPath, { overwrite: true });
        
        const db = SnapshotDb.openFile(targetPath);
        await app.runConnector(db, new JSONConnector, testJSONLoader);

        await util.verifyIModel(db, TestResults[srcFile]);
        db.close();
      }

      fs.unlinkSync(targetPath);
    });
  }

  it("Loader Tests", async () => {
    await testJSONLoader.open();
    const modelFromJSON = await IRModel.fromLoader(testJSONLoader);

    await testSQLiteLoader.open();
    const modelFromSQLite = await IRModel.fromLoader(testSQLiteLoader);

    if (!IRModel.compare(modelFromJSON, modelFromSQLite))
      assert.fail("IR Model from JSON != IR Model from SQLite");
  });
});
