/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { DbResult } from "@itwin/core-bentley";
import { ECSqlStatement, IModelDb } from "@itwin/core-backend";

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
    if (expectedCount !== actualCount)
      mismatches.push({ ecsql, expectedCount, actualCount });
  }
  return mismatches;
}

export interface LocateResult {
  error?: string;
  elementId?: string;
  ecsql?: string;
}

export async function locateElement(db: IModelDb, locator: string): Promise<LocateResult> {

  function isHex(hexstr: string): boolean {
    const hexnum = parseInt(hexstr, 16);
    return `0x${hexnum.toString(16)}` === hexstr.toLowerCase();
  }

  let searchObj: {[ecProperty: string]: string | number} = {};
  try {
    const obj = JSON.parse(locator);
    for (const k of Object.keys(obj)) {
      searchObj[k.toLowerCase()] = obj[k];
    }
  } catch(err) {
    return { error: `Failed to parse Locator. Invalid syntax.` };
  }

  const table = "ecclassid" in searchObj ? searchObj.ecclassid : "bis.element";
  delete searchObj.ecclassid;

  const conds: string[] = [];
  for (const k of Object.keys(searchObj)) {
    const v = searchObj[k];
    if (typeof v === "number")
      conds.push(`${k}=${v}`);
    else if (typeof v === "string" && isHex(v))
      conds.push(`${k}=${v}`);
    else if (typeof v === "string")
      conds.push(`${k}='${v}'`);
  }

  const ecsql = `select ECInstanceId[id] from ${table} where ${conds.join(" and ")}`;
  let rows: any[] = [];
  try {
    rows = await getRows(db, ecsql);
  } catch (err) {
    return { error: `At least one of the properties defined in Locator is unrecognized.`, ecsql };
  }

  if (rows.length === 0)
    return { error: "No target EC entity found.", ecsql };
  if (rows.length > 1)
    return { error: "More than one entity found. You should define a stricter rule in Locator to uniquely identify an EC target entity.", ecsql };

  return { elementId: rows[0].id, ecsql };
}
