import { JSONLoader, JSONLoaderConfig } from "./JSONDriver";
import { FileConnection } from "./Driver";
import * as xlsx from "xlsx";

export interface XLSXLoaderConfig extends JSONLoaderConfig {}

export class XLSXLoader extends JSONLoader {

  public config: XLSXLoaderConfig;

  constructor(config: XLSXLoaderConfig) {
    super(config);
    this.config = config;
  }

  public async open(con: FileConnection) {
    const workbook = xlsx.readFile(con.filepath);
    const sheetNames = workbook.SheetNames;
    for (const sheetName of sheetNames) {
      this.json[sheetName] = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }
  }
}

