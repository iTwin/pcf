/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { IModelDb } from "@bentley/imodeljs-backend";
import { AnyDiagnostic, ISchemaChanges, ISchemaCompareReporter, PrimitiveType, Schema as MetaSchema, SchemaChanges, SchemaComparer, SchemaContext, SchemaContextEditor } from "@bentley/ecschema-metadata";
import { IModelSchemaLoader } from "@bentley/imodeljs-backend/lib/IModelSchemaLoader";
import { MutableSchema } from "@bentley/ecschema-metadata/lib/Metadata/Schema";
import { AuthorizedClientRequestContext } from "@bentley/itwin-client";
import { ClientRequestContext } from "@bentley/bentleyjs-core";
import { ItemState, DMOMap } from "./pcf";
import { DOMParser, XMLSerializer } from "xmldom";

export interface DynamicSchemaProps {
  schemaName: string,
  schemaAlias: string,
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

export async function syncDynamicSchema(
  db: IModelDb, 
  requestContext: AuthorizedClientRequestContext | ClientRequestContext, 
  domainSchemaNames: string[],
  props: DynamicSchemaProps
  ): Promise<ItemState> {

  const { schemaName } = props;
  const existingSchema = await tryGetSchema(db, schemaName);

  const version = getSchemaVersion(db, schemaName);
  const latestSchema = await createDynamicSchema(db, version, domainSchemaNames, props);

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
      dynamicSchema = await createDynamicSchema(db, version, domainSchemaNames, props);
    } else {
      schemaState = ItemState.Unchanged;
      dynamicSchema = existingSchema;
    }
  }

  if (schemaState !== ItemState.Unchanged) {
    const schemaString = await schemaToXmlString(dynamicSchema);
    await db.importSchemaStrings(requestContext, [schemaString]);
  }

  return schemaState;
}

// Generates an in-memory [Dynamic EC Schema](https://www.itwinjs.org/bis/intro/schema-customization/) from user-defined DMO.
export async function createDynamicSchema(
  db: IModelDb, 
  version: SchemaVersion, 
  domainSchemaNames: string[],
  props: DynamicSchemaProps
  ): Promise<MetaSchema> {

  const dmoMap = props.dmoMap;
  const context = new SchemaContext();
  const editor = new SchemaContextEditor(context);

  const createElementClass = async (schema: MetaSchema) => {
    const elementDmos = dmoMap.elements ?? [];
    for (const dmo of elementDmos) {
      if (typeof dmo.ecElement === "string")
        continue;

      const entityResult = await editor.entities.createFromProps(schema.schemaKey, dmo.ecElement);
      if (!entityResult.itemKey)
        throw new Error(`Failed to create EC Entity Class - ${entityResult.errorMessage}`);

      if (dmo.ecElement.properties) {
        for (const prop of dmo.ecElement.properties) {
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
      if (typeof dmo.ecRelationship === "string")
        continue;
      const result = await editor.relationships.createFromProps(schema.schemaKey, dmo.ecRelationship);
      if (!result.itemKey)
        throw new Error(`Failed to create EC Relationship Class - ${result.errorMessage}`);
    }

    const relatedElementDmos = dmoMap.relatedElements ?? [];
    for (const dmo of relatedElementDmos) {
      if (typeof dmo.ecRelationship === "string")
        continue;
      const result = await editor.relationships.createFromProps(schema.schemaKey, dmo.ecRelationship);
      if (!result.itemKey)
        throw new Error(`Failed to create EC Relationship Class - ${result.errorMessage}`);
    }
  };

  const { schemaName, schemaAlias } = props;
  const newSchema = new MetaSchema(context, schemaName, schemaAlias, version.readVersion, version.writeVersion, version.minorVersion);

  const loader = new IModelSchemaLoader(db);
  const bisSchema = loader.getSchema("BisCore");
  await context.addSchema(newSchema);
  await context.addSchema(bisSchema);
  await (newSchema as MutableSchema).addReference(bisSchema); // TODO remove this hack later

  for (const schemaName of domainSchemaNames) {
    const schema = loader.getSchema(schemaName);
    await context.addSchema(schema);
    await (newSchema as MutableSchema).addReference(schema);
  }

  await createElementClass(newSchema);
  await createRelClasses(newSchema);

  return newSchema;
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
