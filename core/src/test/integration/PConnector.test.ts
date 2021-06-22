import { TestUserCredentials, getTestAccessToken, TestBrowserAuthorizationClientConfiguration } from "@bentley/oidc-signin-tool";
import { KnownTestLocations } from "../KnownTestLocations";
import { TestResults } from "../ExpectedTestResults";
import { AuthorizedBackendRequestContext, IModelHost } from "@bentley/imodeljs-backend";
import JSONConnector from "../JSONConnector/JSONConnector";
import { PrimitiveType } from "@bentley/ecschema-metadata";
import { testJSONLoader } from "../TestLoaders";
import { assert } from "chai";
import * as pcf from "../../pcf";
import * as path from "path";
import * as fs from "fs";

const connectorV1 = new JSONConnector();

const connectorV2 = (() => {
  const connector = new JSONConnector();
  connector.tree.models.forEach((model: pcf.ModelNode) => {

    // delete a category manually
    model.elements = model.elements.filter((node: pcf.Node) => node.key !== "SpatialCategory2")

    // add a new dynamic property
    model.elements.forEach((elementNode: pcf.Node) => {
      if (elementNode.key === "ExtPhysicalElement") {
        const dmo = (elementNode as pcf.MultiElementNode).dmo as pcf.ElementDMO;
        if (dmo.classProps) {
          (dmo.classProps as any).properties.push({
            name: "SkyScraperNumber",
            type: PrimitiveType.String,
          });
        }
      }
    });

  });
  return connector;
})();

describe("Integration Tests", () => {

  const testCases = [
    {
      title: "Should synchronize both external and internal elements.",
      sourceFiles: ["v1.json", "v2.json"],
      connectors: [connectorV1, connectorV2]
    },
  ]

  const testHubArgs = new pcf.IntegrationTestArgs({
    projectId: "cef2040d-651e-4307-8b2a-dac0b44fbf7f",
    clientConfig: {
      clientId: "spa-GZnICrOpqnfv9jkaH1MFlri9r",
      redirectUri: "http://localhost:3000/signin-callback",
      scope: "connections:read connections:modify realitydata:read imodels:read imodels:modify library:read storage:read storage:modify openid email profile organization imodelhub context-registry-service:read-only product-settings-service general-purpose-imodeljs-backend imodeljs-router urlps-third-party projectwise-share rbac-user:external-client projects:read projects:modify validation:read validation:modify issues:read issues:modify forms:read forms:modify",
    },
  });

  const testJobArgs = new pcf.JobArgs({
    dataConnection: { kind: "FileConnection", filepath: path.join(KnownTestLocations.testOutputDir, "tempSrcFile.json") },
  });

  const app = new pcf.IntegrationTestApp(testJobArgs, testHubArgs);

  before(async () => {
    await IModelHost.startup();
    if (!fs.existsSync(KnownTestLocations.testOutputDir))
      fs.mkdirSync(KnownTestLocations.testOutputDir);

    await app.silentSignin();
  });

  for (const testCase of testCases) {
    it(testCase.title, async () => {
      try {
        await app.createTestBriefcaseDb();
        for (let i = 0; i < testCase.sourceFiles.length; i++) {
          const srcFile = testCase.sourceFiles[i];
          const connector = testCase.connectors[i];
          const srcPath = path.join(KnownTestLocations.testAssetsDir, srcFile);
          fs.copyFileSync(srcPath, app.jobArgs.dataConnection.filepath);

          const db = await app.downloadTestBriefcaseDb();
          await app.runConnector(db, connector, testJSONLoader);
          await new Promise((r: any) => setTimeout(r, 30 * 1000));

          const updatedDb = await app.downloadTestBriefcaseDb();
          await pcf.verifyIModel(updatedDb, TestResults[srcFile]);
          updatedDb.close();
        }
      } catch(err) {
        assert.fail((err as any).toString());
      } finally {
        await app.purgeTestBriefcaseDb();
        await IModelHost.shutdown();
      }
    });
  }
});
