import {
  isTable,
  type AnyRelations,
  type Column,
  type RelationsRecord,
  type SchemaEntry,
} from "drizzle-orm";
import {
  BigIntResolver,
  ByteResolver,
  DateResolver,
  DateTimeResolver,
  JSONResolver,
} from "graphql-scalars";
import { expandOperations, OperationBasic } from "./libs/operations.js";
import { createInputOperator, createJsonbInputOperator } from "./libs/pothos.js";
import type { SchemaTypes } from "@pothos/core";
import type { DrizzleClient } from "@pothos/plugin-drizzle";

type TableConfig = {
  columns: Column[];
  primaryKeys: { columns: Column[] }[];
  name: string;
};

type RelationalQueryBuilderShim = {
  findFirst: (args: unknown) => Promise<unknown>;
  findMany: (args: unknown) => Promise<unknown[]>;
};

export type DbClient = {
  query: Record<string, RelationalQueryBuilderShim>;
  select: (columns: Record<string, unknown>) => {
    from: (table: unknown) => {
      leftJoin: (
        table: unknown,
        condition: unknown
      ) => {
        where: (condition: unknown) => unknown;
      };
      where: (condition: unknown) => unknown;
    };
  };
  insert: (table: unknown) => {
    values: (values: unknown) => {
      returning: (returning: unknown) => Promise<Record<string, unknown>[]>;
      then: (
        onfulfilled: (value: { rowCount: number } | { rowsAffected: number }) => unknown
      ) => Promise<unknown>;
    };
  };
  update: (table: unknown) => {
    set: (values: unknown) => {
      where: (condition: unknown) => {
        returning: (returning: unknown) => Promise<Record<string, unknown>[]>;
        then: (
          onfulfilled: (value: { rowCount: number } | { rowsAffected: number }) => unknown
        ) => Promise<unknown>;
      };
    };
  };
  delete: (table: unknown) => {
    where: (condition: unknown) => {
      returning: (returning: unknown) => Promise<Record<string, unknown>[]>;
      then: (
        onfulfilled: (value: { rowCount: number } | { rowsAffected: number }) => unknown
      ) => Promise<unknown>;
    };
  };
  transaction: <T>(callback: (tx: DbClient) => Promise<T>) => Promise<T>;
};

export type ModelData = {
  table: SchemaEntry;
  operations: (typeof OperationBasic)[number][];
  tableSingularAlias: string;
  tablePluralAlias: string;
  operationAliases: { [key in (typeof OperationBasic)[number]]?: string };
  filterColumns: string[];
  columns: Column[];
  primaryColumns: Column[];
  inputColumns: Column[];
  tableInfo: TableConfig;
  relations: RelationsRecord;
  executable?:
    | ((params: {
        ctx: object;
        modelName: string;
        operation: (typeof OperationBasic)[number];
      }) => boolean | undefined)
    | undefined;
  limit?:
    | ((params: {
        ctx: object;
        modelName: string;
        operation: (typeof OperationBasic)[number];
      }) => number | undefined)
    | undefined;
  orderBy?:
    | ((params: {
        ctx: object;
        modelName: string;
        operation: (typeof OperationBasic)[number];
      }) => object | undefined)
    | undefined;
  where?:
    | ((params: {
        ctx: object;
        modelName: string;
        operation: (typeof OperationBasic)[number];
      }) => object | undefined)
    | undefined;
  inputData?:
    | ((params: {
        ctx: object;
        modelName: string;
        operation: (typeof OperationBasic)[number];
      }) => object | undefined)
    | undefined;
  depthLimit?:
    | ((params: {
        ctx: object;
        modelName: string;
        operation: (typeof OperationBasic)[number];
      }) => number | undefined)
    | undefined;
};

export class DrizzleGenerator<Types extends SchemaTypes> {
  enums: Record<string, PothosSchemaTypes.EnumRef<Types, unknown>> = {};
  inputOperators: Record<string, PothosSchemaTypes.InputObjectRef<Types, unknown>> = {};
  inputType: Record<string, Record<string, PothosSchemaTypes.InputObjectRef<Types, unknown>>> = {};
  tables?: Record<string, ModelData>;

  builder: PothosSchemaTypes.SchemaBuilder<Types>;
  constructor(builder: PothosSchemaTypes.SchemaBuilder<Types>) {
    this.builder = builder;
    this.createInputType();
  }
  getTableConfig() {
    const drizzleOption = this.builder.options.drizzle;
    return drizzleOption.getTableConfig as (param: SchemaEntry) => TableConfig;
  }
  createTableInfo(): Record<string, ModelData> {
    const options = this.builder.options.pothosDrizzleGenerator;
    const getConfig = this.getTableConfig();
    const relations = this.getRelations();
    const tables = Object.values(relations)
      .filter((t) => isTable(t.table))
      .map(({ name: modelName, table, relations }) => {
        const tableInfo = getConfig(table as never);
        const allOptions = options?.all;
        const modelOptions = options?.models?.[modelName];
        const columns = tableInfo.columns;
        const primaryColumns = Array.from(
          new Set([
            ...tableInfo.primaryKeys.flatMap((v) => v.columns),
            ...columns.filter((v) => v.primary),
          ])
        );

        const operationValue = (modelOptions?.operations ?? allOptions?.operations)?.({
          modelName,
        });
        const operationIncludes = expandOperations(operationValue?.include ?? OperationBasic);
        const operationExcludes = expandOperations(operationValue?.exclude ?? []);
        const operations = operationIncludes.filter((v) => !operationExcludes.includes(v));
        
        const aliasesValue = (modelOptions?.aliases ?? allOptions?.aliases)?.({
          modelName,
        });
        
        const operationAliasValue = (aliasesValue?.operations ?? {});
        const tableSingularAlias = aliasesValue?.singular ?? tableInfo.name;
        const tablePluralAlias = aliasesValue?.plural ?? `${tableInfo.name}s`;
        
        const columnValue = (modelOptions?.fields ?? allOptions?.fields)?.({
          modelName,
        });
        const include = (columnValue?.include as undefined | string[]) ?? [
          ...columns.map((c) => c.name),
          ...Object.keys(relations),
          ...Object.keys(relations).map((v) => `${v}Count`),
        ];
        const exclude = (columnValue?.exclude as undefined | string[]) ?? [];
        const filterColumns = include.filter((name) => !exclude.includes(name));

        const inputFieldValue = (modelOptions?.inputFields ?? allOptions?.inputFields)?.({
          modelName,
        });
        const includeInput = inputFieldValue?.include ?? columns.map((c) => c.name);
        const excludeInput = inputFieldValue?.exclude ?? [];
        const filterInputColumns = includeInput.filter((name) => !excludeInput.includes(name));
        return [
          modelName,
          {
            table,
            relations,
            columns,
            filterColumns,
            primaryColumns,
            operations,
            operationAliases: operationAliasValue,
            tableSingularAlias,
            tablePluralAlias,
            inputColumns: columns.filter((c) => filterInputColumns.includes(c.name)),
            tableInfo,
            executable: modelOptions?.executable ?? allOptions?.executable,
            limit: modelOptions?.limit ?? allOptions?.limit,
            orderBy: modelOptions?.orderBy ?? allOptions?.orderBy,
            where: modelOptions?.where ?? allOptions?.where,
            inputData: modelOptions?.inputData ?? allOptions?.inputData,
            depthLimit: modelOptions?.depthLimit ?? allOptions?.depthLimit,
          },
        ] as const;
      });
    const modelNames = tables.map(([name]) => name);

    const include = options?.use?.include ?? modelNames;
    const exclude = options?.use?.exclude ?? [];
    const filterTables = include.filter((name) => !exclude.includes(name));
    return Object.fromEntries(tables.filter(([name]) => filterTables.includes(name)));
  }
  getClient(ctx: object) {
    const options = this.builder.options;
    const drizzleOption = options.drizzle;
    const client =
      drizzleOption.client instanceof Function ? drizzleOption.client(ctx) : drizzleOption.client;
    return client as typeof client & DbClient;
  }
  getQueryTable(ctx: object, modelName: string) {
    return this.getClient(ctx).query[modelName as never] as RelationalQueryBuilderShim;
  }
  getRelations(): AnyRelations {
    const drizzleOption = this.builder.options.drizzle;
    const client = drizzleOption.client as DrizzleClient;
    return drizzleOption.relations ?? client._.relations;
  }
  getTables() {
    if (this.tables) return this.tables;
    const tables = this.createTableInfo();
    this.tables = tables;
    return tables;
  }
  getTable(table: SchemaEntry) {
    const result = Object.values(this.getTables()).find((v) => v.table === table);
    return result;
  }
  getInputType(
    modelName: string,
    type: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: PothosSchemaTypes.InputObjectTypeOptions<any, any>
  ) {
    if (!this.inputType[modelName]) this.inputType[modelName] = {};
    if (this.inputType[modelName][type]) return this.inputType[modelName][type];
    const { tableSingularAlias } = this.getTables()[modelName]!;
    const input = this.builder.inputRef(`${tableSingularAlias}${type}`);
    input.implement(options);
    this.inputType[modelName][type] = input;
    return input;
  }
  getInputRelation(modelName: string) {
    const { relations } = this.getTables()[modelName]!;

    const relayFields = Object.entries(relations)
      .filter(([, relation]) => relation.through)
      .map(([relationName, relation]) => {
        const rowInputType = this.getInputType(modelName, `_${relationName}Set`, {
          fields: (t) =>
            Object.fromEntries(
              relation.targetColumns.map((col) => [
                col.name,
                t.field({
                  type: this.getDataType(col),
                  required: col.notNull && !col.hasDefault,
                }),
              ])
            ),
        });
        const relationInputType = this.getInputType(modelName, `_${relationName}`, {
          fields: (t) => ({
            set: t.field({ type: [rowInputType] }),
          }),
        });

        return [relationName, relationInputType] as const;
      });
    return relayFields;
  }
  getInputCreate(modelName: string) {
    const { inputColumns } = this.getTables()[modelName]!;

    return this.getInputType(modelName, "Create", {
      fields: (t) => {
        const dbFields = inputColumns.map((col: Column) => [
          col.name,
          t.field({
            type: this.getDataType(col),
            required: col.notNull && !col.hasDefault,
          }),
        ]);
        const relayFields = this.getInputRelation(modelName);

        return Object.fromEntries([
          ...dbFields,
          ...relayFields.map(([name, field]) => [name, t.field({ type: field })]),
        ]);
      },
    });
  }

  getInputUpdate(modelName: string) {
    const { inputColumns } = this.getTables()[modelName]!;
    return this.getInputType(modelName, "Update", {
      fields: (t) => {
        const dbFields = inputColumns.map((c: Column) => [
          c.name,
          t.field({
            type: this.getDataType(c),
          }),
        ]);
        const relayFields = this.getInputRelation(modelName);
        return Object.fromEntries([
          ...dbFields,
          ...relayFields.map(([name, field]) => [name, t.field({ type: field })]),
        ]);
      },
    });
  }
  getInputWhere(modelName: string) {
    const { tableInfo, relations, filterColumns } = this.getTables()[modelName]!;
    const intOperator = this.getInputOperator("Int");
    const inputWhere = this.getInputType(modelName, "Where", {
      fields: (t) => {
        return Object.fromEntries([
          ["AND", t.field({ type: [inputWhere] })],
          ["OR", t.field({ type: [inputWhere] })],
          ["NOT", t.field({ type: inputWhere })],
          ...tableInfo.columns.map((c: Column) => {
            return [
              c.name,
              t.field({
                type: this.getInputOperator(this.getDataType(c), c),
              }),
            ];
          }),
          ...Object.entries(relations).map(([key, relay]) => {
            const table = this.getTable(relay.targetTable);
            if (!table) return [];
            const { tableSingularAlias } = table;
            return [
              key,
              t.field({
                type: `${tableSingularAlias}Where`,
              }),
            ];
          }),
          ...Object.entries(relations).flatMap(([key, relay]) => {
            if (relay.relationType !== "many") return [];
            const table = this.getTable(relay.targetTable);
            if (!table) return [];
            const countName = `${key}Count`;
            if (!filterColumns.includes(countName)) return [];
            return [[countName, t.field({ type: intOperator })]];
          }),
        ]);
      },
    });
    return inputWhere;
  }
  getInputOrderBy(modelName: string) {
    const { tableInfo, relations, filterColumns } = this.getTables()[modelName]!;
    const inputWhere = this.getInputType(modelName, "OrderBy", {
      fields: (t) => {
        return Object.fromEntries([
          ...tableInfo.columns.map((c: Column) => {
            return [
              c.name,
              t.field({
                type: this.enums["OrderBy"]!,
              }),
            ];
          }),
          ...Object.entries(relations).flatMap(([key, relay]) => {
            if (relay.relationType !== "many") return [];
            const table = this.getTable(relay.targetTable);
            if (!table) return [];
            const countName = `${key}Count`;
            if (!filterColumns.includes(countName)) return [];
            return [[countName, t.field({ type: this.enums["OrderBy"]! })]];
          }),
        ]);
      },
    });
    return inputWhere;
  }

  getInputOperator(type: string | [string], column?: Column) {
    const isJsonb = column?.getSQLType() === "jsonb";
    const typeName = Array.isArray(type) ? `Array${type[0]}` : type;
    const cacheKey = isJsonb ? `${typeName}b` : typeName;
    const factory = isJsonb ? createJsonbInputOperator : createInputOperator;
    const input = this.inputOperators[cacheKey] ?? factory(this.builder, type);
    this.inputOperators[cacheKey] = input;
    return input;
  }
  createInputType() {
    const builder: PothosSchemaTypes.SchemaBuilder<Types> = this.builder;

    const scalars = [
      ["BigInt", BigIntResolver],
      ["Date", DateResolver],
      ["Bytes", ByteResolver],
      ["DateTime", DateTimeResolver],
      ["Json", JSONResolver],
    ] as const;
    for (const [scalarName, scalarResolver] of scalars) {
      if (!builder.configStore.hasConfig(scalarName)) {
        builder.addScalarType(scalarName as never, scalarResolver, {});
      }
    }

    this.enums["OrderBy"] = builder.enumType("OrderBy", {
      values: {
        Asc: { value: "asc" },
        Desc: { value: "desc" },
      },
    });
  }
  getDataType(column: Column & { dimensions?: number }): string | [string] {
    const isArray = column.dimensions;
    const types = column.dataType.split(" ");
    if (types[0] === "string" && types[1] !== "enum") {
      return isArray ? ["String"] : "String";
    }
    if (types[0] === "bigint") {
      return isArray ? ["BigInt"] : "BigInt";
    }
    switch (types[1] ?? types[0]) {
      case "enum": {
        const sqlType = column.getSQLType();
        const e = this.enums[sqlType];
        if (!e) {
          this.enums[sqlType] = this.builder.enumType(sqlType, {
            values: column.enumValues!,
          });
        }
        return isArray ? [sqlType] : sqlType;
      }
      case "buffer":
        return isArray ? ["Bytes"] : "Bytes";
      case "json":
        return isArray ? ["Json"] : "Json";
      case "date":
        return isArray ? ["DateTime"] : "DateTime";
      case "boolean":
        return isArray ? ["Boolean"] : "Boolean";
      case "point":
      case "double":
        return isArray ? ["Float"] : "Float";
    }
    if (types[1]?.startsWith("int")) {
      return isArray ? ["Int"] : "Int";
    }
    const type = isArray ? types[1]! : types[0]!;
    const scalarMap: Record<string, string> = {
      number: "Float",
      string: "String",
    };
    const result = scalarMap[type] ?? "String";
    return isArray ? [result] : result;
  }
}