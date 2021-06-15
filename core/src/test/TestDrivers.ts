import { JSONDriver, SQLiteDriver, XLSXDriver } from "../drivers";

const entityKeys = ["ExtPhysicalElement", "ExtPhysicalType", "ExtGroupInformationElement", "ExtSpace", "ExtCategory"];
const relKeys = ["ExtElementRefersToElements", "ExtElementRefersToExistingElements", "ExtElementGroupsMembers", "ExtPhysicalElementAssemblesElements"];

export const testJSONDriver = new JSONDriver({ entityKeys, relKeys });
export const testSQLiteDriver = new SQLiteDriver({ entityKeys, relKeys });
export const testXLSXDriver = new XLSXDriver({ entityKeys, relKeys });

