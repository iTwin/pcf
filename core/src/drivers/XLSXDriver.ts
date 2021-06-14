import { JSONDriver, JSONDriverConfig } from "./JSONDriver";
import * as xlsx from "xlsx";

export interface XLSXDriverConfig extends JSONDriverConfig{}

export class XLSXDriver extends JSONDriver {

  public config: XLSXDriverConfig;

  constructor(config: XLSXDriverConfig) {
    super(config);
    this.config = config;
  }

  public async open(srcDataPath: string) {
    const workbook = xlsx.readFile(srcDataPath);
    const sheetNames = workbook.SheetNames;
    for (const sheetName of sheetNames) {
      this.json[sheetName] = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    }
  }
}

