import { JSONLoader, SQLiteLoader } from "../drivers";
import KnownTestLocations from "./KnownTestLocations";
import * as path from "path";

const config = {
entityKeys: ["ExtPhysicalElement", "ExtPhysicalType", "ExtGroupInformationElement", "ExtSpace", "ExtCategory"],
relKeys: ["ExtElementRefersToElements", "ExtElementRefersToExistingElements", "ExtElementGroupsMembers", "ExtPhysicalElementAssemblesElements"],
}

export const testJSONLoader = new JSONLoader({ kind: "FileConnection", filepath: path.join(KnownTestLocations.testAssetsDir, "v1.json") }, config);
export const testSQLiteLoader = new SQLiteLoader({ kind: "FileConnection", filepath: path.join(KnownTestLocations.testAssetsDir, "v1.sqlite") }, config);

