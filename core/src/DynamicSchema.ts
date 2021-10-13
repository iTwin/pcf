/*---------------------------------------------------------------------------------------------
* Copyright (c) Bentley Systems, Incorporated. All rights reserved.
* See LICENSE.md in the project root for license terms and full copyright notice.
*--------------------------------------------------------------------------------------------*/
import { Schema as MetaSchema, SchemaContext } from "@itwin/ecschema-metadata";
import { AnyDiagnostic, ISchemaChanges, ISchemaCompareReporter, SchemaChanges, SchemaComparer, SchemaContextEditor } from "@itwin/ecschema-editing";
import { IModelSchemaLoader } from "@itwin/core-backend";
import { MutableSchema } from "@itwin/ecschema-metadata/lib/cjs/Metadata/Schema";
import * as bk from "@itwin/core-backend";
import * as pcf from "./pcf";

export interface DynamicEntityMap {
  elements: {
    props: pcf.ECDynamicElementClassProps,
    registeredClass?: typeof bk.Element,
  }[],
  relationships: {
    props: pcf.ECDynamicRelationshipClassProps,
    registeredClass?: typeof bk.Relationship,
  }[],
}

export interface DynamicSchemaProps {
  schemaName: string,
  schemaAlias: string,
  dynamicEntityMap: DynamicEntityMap,
}

export interface SchemaVersion {
  readVersion: number;
  writeVersion: number;
  minorVersion: number;
}

export async function tryGetSchema(db: bk.IModelDb, schemaName: string): Promise<MetaSchema | undefined> {
  const loader = new IModelSchemaLoader(db);
  const schema = loader.tryGetSchema(schemaName);
  return schema;
}

export async function syncDynamicSchema(
  db: bk.IModelDb, 
  domainSchemaNames: string[],
  props: DynamicSchemaProps
  ): Promise<pcf.ItemState> {

  const { schemaName } = props;
  const existingSchema = await tryGetSchema(db, schemaName);

  const version = getSchemaVersion(db, schemaName);
  const latestSchema = await createDynamicSchema(db, version, domainSchemaNames, props);

  let schemaState: pcf.ItemState = pcf.ItemState.New;
  let dynamicSchema = latestSchema;

  if (existingSchema) {
    const reporter = new DynamicSchemaCompareReporter();
    const comparer = new SchemaComparer(reporter);
    await comparer.compareSchemas(latestSchema, existingSchema);
    const schemaIsChanged = reporter.diagnostics.length > 0;

    if (schemaIsChanged) {
      schemaState = pcf.ItemState.Changed;
      version.minorVersion = existingSchema.minorVersion + 1;
      dynamicSchema = await createDynamicSchema(db, version, domainSchemaNames, props);
    } else {
      schemaState = pcf.ItemState.Unchanged;
      dynamicSchema = existingSchema;
    }
  }

  if (schemaState !== pcf.ItemState.Unchanged) {
    const schemaString = await schemaToXmlString(dynamicSchema);
    await db.importSchemaStrings([schemaString]);
    registerDynamicSchema(props);
  }

  return schemaState;
}

function registerDynamicSchema(props: DynamicSchemaProps) {

  const elementsModule: any = {};
  for (const element of props.dynamicEntityMap.elements) {
    if (element.registeredClass) {
      elementsModule[element.registeredClass.className] = element.registeredClass;
    }
  }

  const relationshipsModule: any = {};
  for (const rel of props.dynamicEntityMap.relationships) {
    if (rel.registeredClass) {
      relationshipsModule[rel.registeredClass.className] = rel.registeredClass;
    }
  }

  const dynamicSchemaClass = class BackendDynamicSchema extends bk.Schema {
    public static override get schemaName(): string {
      return props.schemaName;
    }
    public static registerSchema() {
      if (this !== bk.Schemas.getRegisteredSchema(this.schemaName)) {
        bk.Schemas.unregisterSchema(this.schemaName);
        bk.Schemas.registerSchema(this);
        bk.ClassRegistry.registerModule(elementsModule, this);
        bk.ClassRegistry.registerModule(relationshipsModule, this);
      }
    }
  }
  dynamicSchemaClass.registerSchema();
}

// Generates an in-memory [Dynamic EC Schema](https://www.itwinjs.org/bis/intro/schema-customization/) from user-defined DMO.
async function createDynamicSchema(
  db: bk.IModelDb, 
  version: SchemaVersion, 
  domainSchemaNames: string[],
  props: DynamicSchemaProps
  ): Promise<MetaSchema> {

  const map = props.dynamicEntityMap;
  const context = new SchemaContext();
  const editor = new SchemaContextEditor(context);

  const createElementClass = async (schema: MetaSchema) => {
    for (const element of map.elements) {
      const entityResult = await editor.entities.createFromProps(schema.schemaKey, element.props);
      if (!entityResult.itemKey)
        throw new Error(`Failed to create EC Entity Class - ${entityResult.errorMessage}`);

      if (element.props.properties) {
        for (const prop of element.props.properties) {
          const propResult = await editor.entities.createPrimitiveProperty(entityResult.itemKey, prop.name, prop.type as any);
          if (!propResult.itemKey)
            throw new Error(`Failed to create EC Property - ${propResult.errorMessage}`);
        }
      }
    }
  };

  const createRelClasses = async (schema: MetaSchema) => {
    for (const rel of map.relationships) {
      const result = await editor.relationships.createFromProps(schema.schemaKey, rel.props);
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

function getSchemaVersion(db: bk.IModelDb, schemaName: string): SchemaVersion {
  const versionStr = db.querySchemaVersion(schemaName);
  if (!versionStr)
    return { readVersion: 1, writeVersion: 0, minorVersion: 0 };
  const [readVersion, writeVersion, minorVersion] = versionStr!.split(".").map((v: string) => parseInt(v, 10));
  return { readVersion, writeVersion, minorVersion };
}

async function schemaToXmlString(schema: MetaSchema): Promise<string> {
  let xmlDoc = new DOMParser().parseFromString(`<?xml version="1.0" encoding="UTF-8"?>`, "application/xml");
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
