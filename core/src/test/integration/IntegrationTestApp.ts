import { LogLevel, GuidString } from "@bentley/bentleyjs-core";
import { AccessToken } from "@bentley/itwin-client";
import { BriefcaseDb, BriefcaseManager, IModelHost } from "@itwin/core-backend";
import { TestUserCredentials, getTestAccessToken, TestBrowserAuthorizationClientConfiguration } from "@bentley/oidc-signin-tool";
import { BaseApp, JobArgs, HubArgs, Environment } from "../../pcf";

/*
 * extend/utilize this class to create your own integration tests
 */
export class IntegrationTestApp extends BaseApp {

  protected _testBriefcaseDbPath?: string;

  constructor(testJobArgs: JobArgs) {
    const projectId = process.env.imjs_test_project_id;
    const clientId = process.env.imjs_test_client_id;
    if (!projectId)
      throw new Error("environment variable 'imjs_test_project_id' is not defined");
    if (!clientId)
      throw new Error("environment variable 'imjs_test_client_id' is not defined");
    const testHubArgs = new HubArgs({
      projectId,
      iModelId: "not used",
      clientConfig: {
        clientId,
        redirectUri: "http://localhost:3000/signin-callback",
        scope: "connections:read connections:modify realitydata:read imodels:read imodels:modify library:read storage:read storage:modify openid email profile organization imodelhub context-registry-service:read-only product-settings-service general-purpose-imodeljs-backend imodeljs-router urlps-third-party projectwise-share rbac-user:external-client projects:read projects:modify validation:read validation:modify issues:read issues:modify forms:read forms:modify",
      },
      env: Environment.QA,
    });
    testJobArgs.logLevel = LogLevel.Error;
    super(testJobArgs, testHubArgs);
    this.jobArgs = testJobArgs;
    this.hubArgs = testHubArgs;
  }

  /*
   * Sign in through your iModelHub test user account. This call would grab your test user credentials from environment variables.
   */
  public async silentSignin(): Promise<AccessToken> {
    const email = process.env.imjs_test_regular_user_name;
    const password = process.env.imjs_test_regular_user_password;
    if (!email)
      throw new Error("environment variable 'imjs_test_regular_user_name' is not defined for silent signin");
    if (!password)
      throw new Error("environment variable 'imjs_test_regular_user_password' is not defined for silent signin");
    const cred: TestUserCredentials = { email, password };
    const token = await getTestAccessToken(this.hubArgs.clientConfig as TestBrowserAuthorizationClientConfiguration, cred, this.hubArgs.env) as AccessToken;
    this._token = token as any;
    return this._token as any; 
  }

  /*
   * Simulates another user downloading the same briefcase (with a different BriefcaseId)
   */
  public override async openBriefcaseDb(): Promise<BriefcaseDb> {
    if (this._testBriefcaseDbPath)
      await BriefcaseManager.deleteBriefcaseFiles(this._testBriefcaseDbPath, this.token);
    let db: BriefcaseDb | undefined = undefined;
    db = await super.openBriefcaseDb();
    this._testBriefcaseDbPath = db.pathName;
    if (!db)
      throw new Error("Failed to open test BriefcaseDb");
    return db;
  }

  public async createTestBriefcaseDb(name: string): Promise<GuidString> {
    const testIModelName = `${name} - ${process.platform}`;
    const existingIModelId = await IModelHost.hubAccess.queryIModelByName({ accessToken: this.token, iTwinId: this.hubArgs.projectId, iModelName: testIModelName });
    if (existingIModelId) {
      await IModelHost.hubAccess.deleteIModel({ iTwinId: this.hubArgs.projectId, iModelId: existingIModelId, accessToken: this.token });
    }
    const testIModelId = await IModelHost.hubAccess.createNewIModel({ accessToken: this.token, iTwinId: this.hubArgs.projectId, iModelName: testIModelName, description: `Description for ${testIModelName}` });
    this.hubArgs.iModelId = testIModelId;
    return testIModelId;
  }

  public async purgeTestBriefcaseDb(): Promise<void> {
    await IModelHost.hubAccess.deleteIModel({ iTwinId: this.hubArgs.projectId, iModelId: this.hubArgs.iModelId, accessToken: this.token });
    if (this._testBriefcaseDbPath)
      await BriefcaseManager.deleteBriefcaseFiles(this._testBriefcaseDbPath, this.token);
  }
}
