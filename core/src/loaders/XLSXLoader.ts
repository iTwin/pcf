import { JSONLoader } from "./JSONLoader";
import { FileConnection } from "./Loader";
import * as xlsx from "xlsx";

export class XLSXLoader extends JSONLoader {
  public async open(con: FileConnection) {
    const workbook = xlsx.readFile(con.filepath);
    const sheetNames = workbook.SheetNames;
    for (const sheetName of sheetNames) {
      this.json[sheetName] = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }
  }
}

