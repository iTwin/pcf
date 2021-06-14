import { IModelDb } from "@bentley/imodeljs-backend";
import { AnyDiagnostic, ISchemaChanges, ISchemaCompareReporter, PrimitiveType, Schema as MetaSchema, SchemaChanges, SchemaComparer, SchemaContext, SchemaContextEditor } from "@bentley/ecschema-metadata";
import { IModelSchemaLoader } from "@bentley/imodeljs-backend/lib/IModelSchemaLoader";
import { MutableSchema } from "@bentley/ecschema-metadata/lib/Metadata/Schema";
import { AuthorizedClientRequestContext } from "@bentley/itwin-client";
import { ClientRequestContext } from "@bentley/bentleyjs-core";
import { ItemState } from "./fwk/Synchronizer";
import { DMOMap } from "./pcf";
import { DOMParser, XMLSerializer } from "xmldom";
import * as path from "path";

export interface DynamicSchemaProps {
  name: string,
  alias: string,
  domainSchemaNames: string[],
  dmoMap: DMOMap,
}

export interface SchemaVersion {
  readVersion: number;
  writeVersion: number;
  minorVersion: number;
}

export async function tryGetSchema(db: IModelDb, schemaName: string): Promise<MetaSchema | undefined> {
  const loader = new IModelSchemaLoader(db);
  const schema = loader.tryGetSchema(schemaName);
  return schema;
}

export async function syncDynamicSchema(db: IModelDb, requestContext: AuthorizedClientRequestContext | ClientRequestContext, props: DynamicSchemaProps) {

  const schemaName = props.name;
  const existingSchema = await tryGetSchema(db, schemaName);

  const version = getSchemaVersion(db, schemaName);
  const latestSchema = await createDynamicSchema(db, version, props);

  let schemaState: ItemState = ItemState.New;
  let dynamicSchema = latestSchema;

  if (existingSchema) {
    const reporter = new DynamicSchemaCompareReporter();
    const comparer = new SchemaComparer(reporter);
    await comparer.compareSchemas(latestSchema, existingSchema);
    const schemaIsChanged = reporter.diagnostics.length > 0;

    if (schemaIsChanged) {
      schemaState = ItemState.Changed;
      version.minorVersion = existingSchema.minorVersion + 1;
      dynamicSchema = await createDynamicSchema(db, version, props);
    } else {
      schemaState = ItemState.Unchanged;
      dynamicSchema = existingSchema;
    }
  }

  if (schemaState !== ItemState.Unchanged) {
    const schemaString = await schemaToXmlString(dynamicSchema);
    await db.importSchemaStrings(requestContext, [schemaString]);
  }
}

// Generates an in-memory [Dynamic EC Schema](https://www.itwinjs.org/bis/intro/schema-customization/) from user-defined DMO.
export async function createDynamicSchema(db: IModelDb, version: SchemaVersion, props: DynamicSchemaProps): Promise<MetaSchema> {

  const dmoMap = props.dmoMap;
  const context = new SchemaContext();
  const editor = new SchemaContextEditor(context);

  const createEntityClass = async (schema: MetaSchema) => {
    const elementDmos = dmoMap.elements ?? [];
    for (const dmo of elementDmos) {
      if (!dmo.classProps)
        continue;

      const entityResult = await editor.entities.createFromProps(schema.schemaKey, dmo.classProps);
      if (!entityResult.itemKey)
        throw new Error(`Failed to create EC Entity Class - ${entityResult.errorMessage}`);

      if (dmo.classProps.properties) {
        for (const prop of dmo.classProps.properties) {
          const propResult = await editor.entities.createPrimitiveProperty(entityResult.itemKey, prop.name, prop.type as any);
          if (!propResult.itemKey)
            throw new Error(`Failed to create EC Property - ${propResult.errorMessage}`);
        }
      }
    }
  };

  const createRelClasses = async (schema: MetaSchema) => {
    const relationshipDmos = dmoMap.relationships ?? [];
    for (const dmo of relationshipDmos) {
      if (!dmo.classProps)
        continue;
      const result = await editor.relationships.createFromProps(schema.schemaKey, dmo.classProps);
      if (!result.itemKey)
        throw new Error(`Failed to create EC Relationship Class - ${result.errorMessage}`);
    }

    const relatedElementDmos = dmoMap.relatedElements ?? [];
    for (const dmo of relatedElementDmos) {
      if (!dmo.classProps)
        continue;
      const result = await editor.relationships.createFromProps(schema.schemaKey, dmo.classProps);
      if (!result.itemKey)
        throw new Error(`Failed to create EC Relationship Class - ${result.errorMessage}`);
    }
  };

  const newSchema = new MetaSchema(context, props.name, props.alias, version.readVersion, version.writeVersion, version.minorVersion);

  const loader = new IModelSchemaLoader(db);
  const bisSchema = loader.getSchema("BisCore");
  await context.addSchema(newSchema);
  await context.addSchema(bisSchema);
  await (newSchema as MutableSchema).addReference(bisSchema); // TODO remove this hack later

  for (const schemaName of props.domainSchemaNames) {
    const schema = loader.getSchema(schemaName);
    await context.addSchema(schema);
    await (newSchema as MutableSchema).addReference(schema);
  }

  await createEntityClass(newSchema);
  await createRelClasses(newSchema);

  return newSchema;
}

function getECType(tsType: string) {
  const map: {[tsType: string]: PrimitiveType} = {
    string: PrimitiveType.String,
    number: PrimitiveType.Double,
    boolean: PrimitiveType.Boolean,
  };
  return { typeName: tsType, typeValue: map[tsType] };
}

function getSchemaVersion(db: IModelDb, schemaName: string): SchemaVersion {
  const versionStr = db.querySchemaVersion(schemaName);
  if (!versionStr)
    return { readVersion: 1, writeVersion: 0, minorVersion: 0 };
  const [readVersion, writeVersion, minorVersion] = versionStr!.split(".").map((v: string) => parseInt(v, 10));
  return { readVersion, writeVersion, minorVersion };
}

async function schemaToXmlString(schema: MetaSchema): Promise<string> {
  let xmlDoc = new DOMParser().parseFromString(`<?xml version="1.0" encoding="UTF-8"?>`);
  xmlDoc = await schema.toXml(xmlDoc);
  const xmlString = new XMLSerializer().serializeToString(xmlDoc);
  return xmlString;
}

function schemaToJson(schema: MetaSchema): string {
  const jsonString = JSON.stringify(schema.toJSON());
  return jsonString;
}

class DynamicSchemaCompareReporter implements ISchemaCompareReporter {
  public changes: SchemaChanges[] = [];

  public report(schemaChanges: ISchemaChanges): void {
    this.changes.push(schemaChanges as SchemaChanges);
  }

  public get diagnostics(): AnyDiagnostic [] {
    let diagnostics: AnyDiagnostic [] = [];
    for (const changes of this.changes) {
      diagnostics = diagnostics.concat(changes.allDiagnostics);
    }
    return diagnostics;
  }
}
