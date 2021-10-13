import * as pcf from "../../pcf";

export class TestAPILoader extends pcf.Loader {

  protected async _open(con: pcf.APIConnection) {};

  protected async _close(): Promise<void> {};

  protected async _getEntities(): Promise<pcf.IREntity[]> {
    return [];
  };

  protected async _getRelationships(): Promise<pcf.IRRelationship[]> {
    return [];
  };

  protected async _getInstances(entityKey: string): Promise<pcf.IRInstance[]> {
    return [];
  };

  public override toJSON(): any {
    return { mtime: String(new Date().getTime()), ...super.toJSON() };
  }
}

