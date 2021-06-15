import { BentleyStatus, Logger, LogLevel } from "@bentley/bentleyjs-core";
import { IModelHost, IModelJsFs, SnapshotDb } from "@bentley/imodeljs-backend";
import { BridgeJobDefArgs, BridgeRunner } from "../../fwk/BridgeRunner";
import { KnownTestLocations } from "../KnownTestLocations";
import { TestResults } from "../ExpectedTestResults";
import { PConnector } from "../../PConnector";
import { IRModel } from "../../IRModel";
import * as util from "../../Utils";
import { LogCategory } from "../../LogCategory";
import * as testDrivers from "../TestDrivers";
import { assert, expect } from "chai";
import * as path from "path";
import * as fs from "fs";

describe("Unit Tests", () => {

  async function runConnector(sourcePath: string, bridgeModule: string) {
    const bridgeJobDef = new BridgeJobDefArgs();
    bridgeJobDef.sourcePath = sourcePath;
    bridgeJobDef.bridgeModule = bridgeModule;
    bridgeJobDef.outputDir = KnownTestLocations.testOutputDir;
    bridgeJobDef.isSnapshot = true;

    const runner = new BridgeRunner(bridgeJobDef);
    const result = await runner.synchronize();
    expect(result === BentleyStatus.SUCCESS);
  }

  const testCases: any = [
    {
      title: "Should create empty snapshotDb and synchronize source data (JSON)",
      sourceFiles: ["v1.json"],
      bridgeModule: path.join(KnownTestLocations.JSONConnectorDir, "JSONConnector.js"),
    },
  ];

  before(async () => {
    await IModelHost.startup();

    Logger.initializeToConsole();
    Logger.configureLevels({
      defaultLevel: LogLevel[LogLevel.Error],
      categoryLevels: [
        {
          category: LogCategory.PCF,
          logLevel: LogLevel[LogLevel.Info],
        },
      ]
    });

    if (!fs.existsSync(KnownTestLocations.testOutputDir))
      fs.mkdirSync(KnownTestLocations.testOutputDir);
  });

  after(async () => {
    await IModelHost.shutdown();
  });

  const tempSrcPath = path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json");
  const targetPath = path.join(KnownTestLocations.testOutputDir, `${path.basename(tempSrcPath!, path.extname(tempSrcPath!))}.bim`);

  for (const testCase of testCases) {
    it(testCase.title, async () => {
      if (fs.existsSync(targetPath))
        fs.unlinkSync(targetPath);

      SnapshotDb.createEmpty(targetPath, { rootSubject: { name: PConnector.RootSubjectName } }).close();

      for (const srcFile of testCase.sourceFiles) {
        const srcPath = path.join(KnownTestLocations.testAssetsDir, srcFile);
        IModelJsFs.copySync(srcPath, tempSrcPath, { overwrite: true });
        await runConnector(tempSrcPath, testCase.bridgeModule);
        const db = SnapshotDb.openFile(targetPath);
        await util.verifyIModel(db, TestResults[srcFile]);
        db.close();
      }

      fs.unlinkSync(targetPath);
    });
  }

  it("Driver Tests", async () => {
    await testDrivers.testJSONDriver.open(path.join(KnownTestLocations.testAssetsDir, "v1.json"));
    const modelFromJSON = await IRModel.fromDriver(testDrivers.testJSONDriver);

    await testDrivers.testSQLiteDriver.open(path.join(KnownTestLocations.testAssetsDir, "v1.sqlite"));
    const modelFromSQLite = await IRModel.fromDriver(testDrivers.testSQLiteDriver);

    if (!IRModel.compare(modelFromJSON, modelFromSQLite))
      assert.fail("IR Model from JSON != IR Model from SQLite");
  });
});
