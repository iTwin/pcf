import { JSONLoader } from "./JSONDriver";
import { FileConnection, LoaderConfig } from "./Driver";
import * as xlsx from "xlsx";

export class XLSXLoader extends JSONLoader {

  constructor(connection: FileConnection, config: LoaderConfig) {
    super(connection, config);
  }

  public async open() {
    const workbook = xlsx.readFile(this.connection.filepath);
    const sheetNames = workbook.SheetNames;
    for (const sheetName of sheetNames) {
      this.json[sheetName] = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }
  }
}

