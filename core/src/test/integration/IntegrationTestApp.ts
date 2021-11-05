import { GuidString, LogLevel } from "@itwin/core-bentley";
import { AccessToken } from "@itwin/core-bentley";
import { BriefcaseDb, BriefcaseManager, IModelHost } from "@itwin/core-backend";
import { TestUserCredentials, TestUtility, TestBrowserAuthorizationClientConfiguration } from "@itwin/oidc-signin-tool";
import { BaseApp, HubArgs, ReqURLPrefix } from "../../pcf";

/*
 * extend/utilize this class to create your own integration tests
 */
export class IntegrationTestApp extends BaseApp {

  protected _testBriefcaseDbPath?: string;

  constructor() {
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
        scope: "openid profile organization email itwinjs",
      },
      urlPrefix: ReqURLPrefix.QA,
    });
    super(testHubArgs, LogLevel.Trace);
    this.hubArgs = testHubArgs;
  }

  /*
   * Sign in through your iModelHub test user account. This call would grab your test user credentials from environment variables.
   */
  public override async nonInteractiveSignin(): Promise<AccessToken> {
    const email = process.env.imjs_test_regular_user_name;
    const password = process.env.imjs_test_regular_user_password;
    if (!email)
      throw new Error("environment variable 'imjs_test_regular_user_name' is not defined for silent signin");
    if (!password)
      throw new Error("environment variable 'imjs_test_regular_user_password' is not defined for silent signin");

    const cred: TestUserCredentials = { email, password };
    const client = await TestUtility.getAuthorizationClient(cred, this.hubArgs.clientConfig as TestBrowserAuthorizationClientConfiguration);
    const token = await client.getAccessToken();
    IModelHost.authorizationClient = client;

    if (!token)
      throw new Error("Failed to get test access token");
    this._token = token;
    return this._token; 
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
    const testIModelName = `${name}-${process.platform}`;
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
