import * as bk from "@bentley/imodeljs-backend";
import * as chai from "chai";
import * as path from "path";
import * as fs from "fs";
import * as pcf from "../../pcf";
import KnownTestLocations from "../KnownTestLocations";
import TestResults from "../ExpectedTestResults";
import TestLoaderConfig from "../TestLoaderConfig";
import { JSONLoader, SQLiteLoader } from "../../drivers";

describe("Unit Tests", () => {

  const testCases: any = [
    {
      title: "Should create empty snapshotDb and synchronize source data (JSON)",
      sourceFiles: ["v1.json"],
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

  const testJobArgs = new pcf.JobArgs({
    connectorPath: path.join(KnownTestLocations.JSONConnectorDir, "JSONConnector.js"),
    con: { kind: "FileConnection", filepath: path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json") },
  })

  const app = new pcf.BaseApp(testJobArgs);

  const tempSrcPath = path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json");
  const targetPath = path.join(KnownTestLocations.testOutputDir, `${path.basename(tempSrcPath!, path.extname(tempSrcPath!))}.bim`);

  for (const testCase of testCases) {
    it(testCase.title, async () => {
      if (fs.existsSync(targetPath))
        fs.unlinkSync(targetPath);

      bk.StandaloneDb.createEmpty(targetPath, { rootSubject: { name: "TestRootSubject" } }).close();

      for (const srcFile of testCase.sourceFiles) {
        const srcPath = path.join(KnownTestLocations.testAssetsDir, srcFile);
        bk.IModelJsFs.copySync(srcPath, tempSrcPath, { overwrite: true });
        
        const db = bk.StandaloneDb.openFile(targetPath);
        const loader = new JSONLoader(app.jobArgs.con, TestLoaderConfig);
        await app.run(db, loader);

        const updatedDb = bk.StandaloneDb.openFile(targetPath);
        await pcf.verifyIModel(updatedDb, TestResults[srcFile]);
        updatedDb.close();
      }

      fs.unlinkSync(targetPath);
    });
  }

  it("Loader Tests", async () => {
    const jsonLoader = new JSONLoader({ kind: "FileConnection", filepath: path.join(KnownTestLocations.testAssetsDir, "v1.json")}, TestLoaderConfig);
    await jsonLoader.open();
    const modelFromJSON = await pcf.IRModel.fromLoader(jsonLoader);

    const sqliteLoader = new SQLiteLoader({ kind: "FileConnection", filepath: path.join(KnownTestLocations.testAssetsDir, "v1.sqlite")}, TestLoaderConfig);
    await sqliteLoader.open();
    const modelFromSQLite = await pcf.IRModel.fromLoader(sqliteLoader);

    if (!pcf.IRModel.compare(modelFromJSON, modelFromSQLite))
      chai.assert.fail("IR Model from JSON != IR Model from SQLite");
  });
});
