import { JSONLoader } from "./JSONDriver";
import { DataConnection, LoaderConfig } from "./Driver";
import * as xlsx from "xlsx";

export class XLSXLoader extends JSONLoader {

  constructor(con: DataConnection, config: LoaderConfig) {
    super(con, config);
  }

  public async open() {
    const workbook = xlsx.readFile(this.con.filepath);
    const sheetNames = workbook.SheetNames;
    for (const sheetName of sheetNames) {
      this.json[sheetName] = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }
  }
}

