import { JSONLoader, SQLiteLoader, XLSXLoader } from "../drivers";

const entityKeys = ["ExtPhysicalElement", "ExtPhysicalType", "ExtGroupInformationElement", "ExtSpace", "ExtCategory"];
const relKeys = ["ExtElementRefersToElements", "ExtElementRefersToExistingElements", "ExtElementGroupsMembers", "ExtPhysicalElementAssemblesElements"];

export const testJSONDriver = new JSONLoader({ entityKeys, relKeys });
export const testSQLiteDriver = new SQLiteLoader({ entityKeys, relKeys });
export const testXLSXDriver = new XLSXLoader({ entityKeys, relKeys });

