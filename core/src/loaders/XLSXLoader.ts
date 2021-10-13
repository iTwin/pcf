/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { JSONLoader } from "./JSONLoader";
import { FileConnection } from "./Loader";
import * as xlsx from "xlsx";

/* 
 * XLSX (Excel) => IR Model Mappings:
 * 
 * Each Excel Sheet    = IR Entity
 * Each row of a sheet = IR Instance
 * 
 */
export class XLSXLoader extends JSONLoader {
  protected override async _open(con: FileConnection) {
    const workbook = xlsx.readFile(con.filepath);
    const sheetNames = workbook.SheetNames;
    for (const sheetName of sheetNames) {
      this.json[sheetName] = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }
  }
}

