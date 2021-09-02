import * as pcf from "../../pcf";

export class TestAPILoader extends pcf.JSONLoader {
  protected async _open() {}
  public async getVersion(): Promise<string> {
    return String(new Date().getTime());
  }
}

