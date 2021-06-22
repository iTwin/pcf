import { JSONLoader } from "../../drivers";
import * as bk from "@bentley/imodeljs-backend";
import * as pcf from "../../pcf";

async function run() {
  await bk.IModelHost.startup();
  const { jobArgs, hubArgs } = require("./args");
  const app = new pcf.BaseApp(jobArgs, hubArgs);
  const loader = new JSONLoader(app.jobArgs.dataConnection, {
    entityKeys: ["ExtPhysicalElement", "ExtPhysicalType", "ExtGroupInformationElement", "ExtSpace", "ExtCategory"],
    relKeys: ["ExtElementRefersToElements", "ExtElementRefersToExistingElements", "ExtElementGroupsMembers", "ExtPhysicalElementAssemblesElements"],
  });
  await app.signin();
  const db = await app.downloadBriefcaseDb();
  await app.run(db, loader);
  await bk.IModelHost.shutdown();
}
