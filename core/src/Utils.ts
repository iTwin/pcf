import { DbResult, Logger } from "@bentley/bentleyjs-core";
import { ECSqlStatement, IModelDb } from "@bentley/imodeljs-backend";
import { assert } from "chai";
import { LogCategory } from "./LogCategory";

export interface QueryToCount {
  [ecsql: string]: number;
}

export interface Mistmatch {
  ecsql: string;
  expectedCount: number;
  actualCount: number;
}

export enum TestTypes {
  NoUpdate,
  InitialRun,
  Data,
  SchemaAddColumn,
  SchemaRenameColumn,
}

export async function getRows(db: IModelDb, ecsql: string): Promise<any[]> {
  const rows: any[] = [];
  await db.withPreparedStatement(ecsql, async (statement: ECSqlStatement): Promise<void> => {
    while (DbResult.BE_SQLITE_ROW === statement.step()) {
      rows.push(statement.getRow());
    }
  });
  return rows;
}

export async function verifyIModel(db: IModelDb, qtc: QueryToCount): Promise<Mistmatch[]> {
  const ecsqls = Object.keys(qtc);
  const mismatches: Mistmatch[] = [];
  for (const ecsql of ecsqls) {
    const expectedCount = qtc[ecsql];
    const rows = await getRows(db, ecsql);
    const actualCount = rows.length;
    Logger.logInfo(LogCategory.PCF, `${ecsql} => ${actualCount} rows`);
    if (expectedCount !== actualCount)
      mismatches.push({ ecsql, expectedCount, actualCount });
  }
  return mismatches;
}

export interface SearchResult {
  error?: string;
  elementId?: string;
  ecsql?: string;
}

export async function searchElement(db: IModelDb, searchKey: string): Promise<SearchResult> {

  function isHex(hexstr: string): boolean {
    const hexnum = parseInt(hexstr, 16);
    return `0x${hexnum.toString(16)}` === hexstr.toLowerCase();
  }

  let searchObj: {[ecProperty: string]: string | number} = {};
  try {
    const obj = JSON.parse(searchKey);
    for (const k of Object.keys(obj)) {
      searchObj[k.toLowerCase()] = obj[k];
    }
  } catch(err) {
    return { error: `Failed to parse searchKey. Invalid syntax.` };
  }

  const table = "ecclassid" in searchObj ? searchObj.ecclassid : "bis.element";
  delete searchObj.ecclassid;

  const conds: string[] = [];
  for (const k of Object.keys(searchObj)) {
    const v = searchObj[k];
    if (typeof v === "number") {
      conds.push(`${k}=${v}`);
    } else if (typeof v === "string" && isHex(v)) {
      conds.push(`${k}=${v}`);
    } else if (typeof v === "string") {
      conds.push(`${k}='${v}'`);
    }
  }

  const ecsql = `select ECInstanceId[id] from ${table} where ${conds.join(" and ")}`;
  let rows: any[] = [];
  try {
    rows = await getRows(db, ecsql);
  } catch (err) {
    return { error: `At least one of the specified properties in SearchKey is unrecognized.`, ecsql };
  }

  if (rows.length === 0)
    return { error: "No target element found.", ecsql };
  if (rows.length > 1)
    return { error: "More than one target element found", ecsql };

  return { elementId: rows[0].id, ecsql };
}

export async function retryLoop(atomicOp: () => Promise<void>): Promise<void> {
  while (true) {
    try {
      await atomicOp();
    } catch(err) {
      if ((err as any).status === 429) { // Too Many Request Error 
        Logger.logInfo(LogCategory.PCF, "Requests are sent too frequent. Sleep for 60 seconds.");
        await new Promise(resolve => setTimeout(resolve, 60 * 1000));
      } else {
        throw err;
      }
      continue;
    }
    await new Promise(resolve => setTimeout(resolve, 20 * 1000));
    break;
  }
}

