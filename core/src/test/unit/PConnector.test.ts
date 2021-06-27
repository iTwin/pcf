import * as bk from "@bentley/imodeljs-backend";
import * as chai from "chai";
import * as path from "path";
import * as fs from "fs";
import * as pcf from "../../pcf";
import KnownTestLocations from "../KnownTestLocations";
import TestResults from "../ExpectedTestResults";
import { JSONLoader, SQLiteLoader } from "../../loaders";
import { PConnector } from "../../PConnector";

describe("Unit Tests", () => {

  const tempSrcPath = path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json");

  const testCases = [
    {
      title: "synchronize StandaloneDb",
      jobs: [
        { 
          sourceFile: "v1.json", 
          connectorFile: "JSONConnector.js", 
          connection: { 
            sourceKey: "sourceKey1", 
            kind: "pcf_file_connection", 
            filepath: tempSrcPath,
          } 
        },
        { 
          sourceFile: "v2.json", 
          connectorFile: "JSONConnectorV2.js", 
          connection: { 
            sourceKey: "sourceKey1", 
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
        const { sourceFile, connection, connectorFile } = job;
        const connectorPath = path.join(KnownTestLocations.JSONConnectorDir, connectorFile);

        const sourcePath = path.join(KnownTestLocations.testAssetsDir, sourceFile);
        bk.IModelJsFs.copySync(sourcePath, tempSrcPath, { overwrite: true });

        const db = bk.StandaloneDb.openFile(targetPath);
        const jobArgs = new pcf.JobArgs({ connectorPath, connection } as pcf.JobArgsProps);
        const connector: PConnector = require(jobArgs.connectorPath).default();
        connector.init({ db, jobArgs });
        await connector.runJob();
        db.close();

        await new Promise(resolve => setTimeout(resolve, 1000));

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
    const connector: PConnector = require(connectorPath).default();

    connector.loader = new JSONLoader(connector, connector.loader.props);
    await connector.loader.open({ sourceKey: "json", kind: "pcf_file_connection", filepath: path.join(KnownTestLocations.testAssetsDir, "v1.json")});
    const modelFromJSON = await pcf.IRModel.fromLoader(connector.loader);
    await connector.loader.close();

    connector.loader = new SQLiteLoader(connector, connector.loader.props);
    await connector.loader.open({ sourceKey: "sqlite", kind: "pcf_file_connection", filepath: path.join(KnownTestLocations.testAssetsDir, "v1.sqlite")});
    const modelFromSQLite = await pcf.IRModel.fromLoader(connector.loader);
    await connector.loader.close();

    if (!pcf.IRModel.compare(modelFromJSON, modelFromSQLite))
      chai.assert.fail("IR Model from JSON != IR Model from SQLite");
  });
});

