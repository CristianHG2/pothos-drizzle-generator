import { and, eq, sql, type Column, type RelationsRecord, type SQL } from "drizzle-orm";
import { createRelationCountSQL, createWhereQuery } from "./drizzle.js";
import { getQueryFields, type FieldTree } from "./graphql.js";
import { checkPermissionsAndGetParams } from "./permissions.js";
import type { DbClient, ModelData } from "../generator.js";
import type { ResolvedOperationParams } from "./permissions.js";
import type { GraphQLResolveInfo } from "graphql";

type QueryArgs = {
  offset?: number;
  limit?: number;
  where?: object;
  orderBy?: object[];
};

/**
 * Context enabling `${relationName}Count` filter/orderBy keys in the relational
 * query pipeline. Build with `buildRelationCountContext` from a ModelData's
 * relations plus ctx/tables (to resolve permissions for counted relations).
 */
export type RelationCountContext = {
  relations: RelationsRecord;
  relationPermissionsSQL: RelationPermissionsSQL;
};

export type RelationPermissionsSQL = {
  get: (relationName: string) => SQL | undefined;
};

/**
 * A counted relation's permissions (`executable`, `where`) are resolved only
 * when a `${relationName}Count` key is actually used, and then once. Resolving
 * them up front made every query on a model fail as soon as one of its many
 * relations was not countable by the caller, or carried a `where` the SQL
 * builder cannot compile, even when nothing was counted.
 */
export function buildRelationCountContext(
  relations: RelationsRecord,
  ctx: object,
  tables: Record<string, ModelData>
): RelationCountContext {
  const cache = new Map<string, SQL | undefined>();
  const get = (relationName: string) => {
    if (cache.has(relationName)) return cache.get(relationName);
    const relay = relations[relationName];
    if (!relay || relay.relationType !== "many") return undefined;
    const target = tables[relay.targetTableName];
    if (!target) return undefined;
    const params = checkPermissionsAndGetParams(
      relay.targetTableName,
      "count",
      ctx,
      null,
      target
    );
    const permSQL = params.where
      ? createWhereQuery(relay.targetTable, params.where as never)
      : undefined;
    cache.set(relationName, permSQL);
    return permSQL;
  };
  return { relations, relationPermissionsSQL: { get } };
}

// Custom JSONB operators not supported by drizzle's relational query API.
// These get converted to RAW SQL entries in the where tree.
const CUSTOM_JSONB_OPS = new Set([
  "contains",
  "containedBy",
  "hasKey",
  "hasAnyKeys",
  "hasAllKeys",
]);

const ALL_OPERATOR_KEYS = new Set([
  "eq", "ne", "gt", "gte", "lt", "lte", "like", "notLike", "ilike", "notIlike",
  "isNull", "isNotNull", "in", "notIn",
  "arrayContains", "arrayContained", "arrayOverlaps",
  "AND", "OR", "NOT",
  ...CUSTOM_JSONB_OPS,
]);

type WhereNode = Record<string, unknown>;

function isColumnFilter(value: Record<string, unknown>): boolean {
  return Object.keys(value).every((k) => ALL_OPERATOR_KEYS.has(k));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildCustomOpSQL(sqlFn: typeof sql, column: any, op: string, value: unknown) {
  switch (op) {
    case "contains":
      return sqlFn`${column} @> ${JSON.stringify(value)}::jsonb`;
    case "containedBy":
      return sqlFn`${column} <@ ${JSON.stringify(value)}::jsonb`;
    case "hasKey":
      return sqlFn`jsonb_exists(${column}, ${value})`;
    case "hasAnyKeys":
      return sqlFn`jsonb_exists_any(${column}, array[${sqlFn.join(
        (value as string[]).map((v) => sqlFn`${v}`),
        sqlFn`, `
      )}])`;
    case "hasAllKeys":
      return sqlFn`jsonb_exists_all(${column}, array[${sqlFn.join(
        (value as string[]).map((v) => sqlFn`${v}`),
        sqlFn`, `
      )}])`;
  }
}

type CountFilterPart = { relationName: string; ops: Record<string, unknown> };

function transformWhereNode(
  node: WhereNode,
  context?: RelationCountContext
): WhereNode {
  const result: WhereNode = {};
  const rawParts: { columnName: string; op: string; value: unknown }[] = [];
  const countParts: CountFilterPart[] = [];

  for (const [key, value] of Object.entries(node)) {
    if (value === undefined) continue;

    if ((key === "AND" || key === "OR") && Array.isArray(value)) {
      result[key] = value.map((v) => transformWhereNode(v as WhereNode, context));
    } else if (key === "NOT" && typeof value === "object" && value !== null) {
      result[key] = transformWhereNode(value as WhereNode, context);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const objValue = value as Record<string, unknown>;
      // Detect `${relationName}Count` filter keys against the model's relations.
      if (context && key.endsWith("Count")) {
        const relName = key.slice(0, -"Count".length);
        const relay = context.relations[relName];
        if (relay && relay.relationType === "many" && isColumnFilter(objValue)) {
          const ops: Record<string, unknown> = {};
          for (const [op, opVal] of Object.entries(objValue)) {
            if (opVal !== undefined) ops[op] = opVal;
          }
          if (Object.keys(ops).length > 0) {
            countParts.push({ relationName: relName, ops });
          }
          continue;
        }
      }
      if (isColumnFilter(objValue)) {
        const standardOps: Record<string, unknown> = {};
        for (const [op, opVal] of Object.entries(objValue)) {
          if (opVal === undefined) continue;
          if (CUSTOM_JSONB_OPS.has(op)) {
            rawParts.push({ columnName: key, op, value: opVal });
          } else {
            standardOps[op] = opVal;
          }
        }
        if (Object.keys(standardOps).length > 0) {
          result[key] = standardOps;
        }
      } else {
        result[key] = transformWhereNode(objValue, context);
      }
    } else {
      result[key] = value;
    }
  }

  if (rawParts.length > 0 || countParts.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result.RAW = (table: any, ops: { sql: typeof sql; and: typeof and }) => {
      const parts: SQL[] = [];
      for (const { columnName, op, value } of rawParts) {
        const col = ops.sql`${table}.${ops.sql.identifier(columnName)}`;
        const built = buildCustomOpSQL(ops.sql, col, op, value);
        if (built) parts.push(built);
      }
      for (const { relationName, ops: countOps } of countParts) {
        const relay = context!.relations[relationName]!;
        const permSQL = context!.relationPermissionsSQL.get(relationName);
        const countSQL = createRelationCountSQL(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (name) => (table as any)[name] as Column,
          relay,
          permSQL
        );
        for (const [op, opVal] of Object.entries(countOps)) {
          const fn = COUNT_OPERATOR_MAP[op];
          if (!fn) continue;
          parts.push(fn(countSQL, opVal));
        }
      }
      return parts.length === 1 ? parts[0]! : ops.and(...parts)!;
    };
  }

  return result;
}

// Operator functions usable against a SQL expression (the COUNT subquery).
// Mirrors drizzle's operator set for Int-like filters.
const COUNT_OPERATOR_MAP: Record<string, (expr: SQL, value: unknown) => SQL> = {
  eq: (expr, v) => sql`${expr} = ${v}`,
  ne: (expr, v) => sql`${expr} <> ${v}`,
  gt: (expr, v) => sql`${expr} > ${v}`,
  gte: (expr, v) => sql`${expr} >= ${v}`,
  lt: (expr, v) => sql`${expr} < ${v}`,
  lte: (expr, v) => sql`${expr} <= ${v}`,
  in: (expr, v) =>
    sql`${expr} IN (${sql.join((v as unknown[]).map((x) => sql`${x}`), sql`, `)})`,
  notIn: (expr, v) =>
    sql`${expr} NOT IN (${sql.join((v as unknown[]).map((x) => sql`${x}`), sql`, `)})`,
};

export function transformWhereForRelationalQuery(
  where: WhereNode | undefined,
  context?: RelationCountContext
): WhereNode | undefined {
  if (!where) return where;
  return transformWhereNode(where, context);
}

export function prepareQueryOptions(
  args: QueryArgs,
  params: ResolvedOperationParams,
  isMany: boolean,
  context?: RelationCountContext
) {
  const where = transformWhereForRelationalQuery(
    {
      AND: [structuredClone(args.where), params.where].filter((v) => v),
    },
    context
  )!;

  const orderBy = resolveOrderBy(args.orderBy, params.orderBy, context);

  const queryOptions: Omit<QueryArgs, "orderBy"> & {
    where: object;
    orderBy?: object | ((table: unknown, ops: unknown) => unknown);
  } = {
    ...args,
    where,
    orderBy,
  };

  if (isMany) {
    queryOptions.limit =
      params.limit != null && args.limit != null
        ? Math.min(params.limit, args.limit)
        : (params.limit ?? args.limit);
  }

  return queryOptions;
}

/**
 * Build the relational-query `orderBy` option. Flat column sort stays as an
 * object (backwards compatible). When any sort key is a `${relationName}Count`
 * known to `context`, switch to the callback form so we can emit a correlated
 * COUNT subquery as the order-by expression.
 */
export function resolveOrderBy(
  argsOrderBy: object[] | undefined,
  paramsOrderBy: object | undefined,
  context?: RelationCountContext
):
  | object
  | undefined
  | ((
      table: Record<string, Column>,
      ops: {
        sql: typeof sql;
        asc: (expr: SQL | Column) => SQL;
        desc: (expr: SQL | Column) => SQL;
      }
    ) => SQL[]) {
  const entries: [string, unknown][] =
    argsOrderBy && Object.keys(argsOrderBy).length
      ? argsOrderBy.flatMap((v) => Object.entries(v))
      : paramsOrderBy
        ? Object.entries(paramsOrderBy)
        : [];

  if (entries.length === 0) return undefined;

  const hasCount =
    context &&
    entries.some(([key]) => {
      if (!key.endsWith("Count")) return false;
      const rel = context.relations[key.slice(0, -"Count".length)];
      return rel && rel.relationType === "many";
    });

  if (!hasCount) {
    return Object.fromEntries(entries);
  }

  return (table, ops) => {
    return entries.flatMap(([key, direction]) => {
      const dir = String(direction).toLowerCase() === "desc" ? ops.desc : ops.asc;
      if (key.endsWith("Count")) {
        const relName = key.slice(0, -"Count".length);
        const relay = context!.relations[relName];
        if (relay && relay.relationType === "many") {
          const permSQL = context!.relationPermissionsSQL.get(relName);
          const countSQL = createRelationCountSQL(
            (name) => table[name] as Column,
            relay,
            permSQL
          );
          return [dir(countSQL)];
        }
      }
      const col = table[key];
      return col ? [dir(col)] : [];
    });
  };
}

export function separateInput(input: object, columns: Pick<Column, "name">[]) {
  const dbColumnsInput: Record<string, unknown> = {};
  const relationFieldsInput: [string, unknown][] = [];

  for (const [key, value] of Object.entries(input)) {
    if (columns.some((col) => col.name === key)) {
      dbColumnsInput[key] = value;
    } else {
      relationFieldsInput.push([key, value]);
    }
  }

  return { dbColumnsInput, relationFieldsInput };
}

export async function insertRelayValue({
  results,
  client,
  relationInputs,
  relations,
}: {
  results: Record<string, unknown>[];
  client: DbClient;
  relationInputs: [string, unknown][][];
  relations: RelationsRecord;
}) {
  for (const index in results) {
    const result = results[index];
    const relationInput = relationInputs[index];
    if (!result || !relationInput?.length) continue;
    for (const [relationName, value] of relationInput) {
      const inputPayload = value as { set?: Record<string, unknown>[] };
      const itemsToSet = inputPayload.set;

      const relay = relations[relationName];
      if (!itemsToSet || !relay?.through || !relay.throughTable) continue;

      const { throughTable } = relay;

      const sourceToThroughMap = Object.fromEntries(
        relay.sourceColumns.map((v, i) => [v.name, relay.through!.source[i]!._.key])
      );
      const targetToThroughMap = Object.fromEntries(
        relay.targetColumns.map((v, i) => [v.name, relay.through!.target[i]!._.key])
      );

      const sourceFilters = relay.sourceColumns.map(
        (v) => [sourceToThroughMap[v.name], result[v.name]] as const
      );
      await client
        .delete(throughTable as never)
        .where(
          and(...sourceFilters.map(([key, val]) => eq(relay.throughTable![key as never], val)))
        );

      const insertRows = itemsToSet.map((item) => {
        const targetValues = Object.entries(item).map(([key, val]) => [
          targetToThroughMap[key],
          val,
        ]);
        return Object.fromEntries([...targetValues, ...sourceFilters]);
      });

      if (insertRows.length > 0) {
        await client.insert(throughTable as never).values(insertRows);
      }
    }
  }
}

interface QueryDataType {
  columns?: Record<string, boolean>;
  with?: Record<string, QueryDataType>;
  _name?: string;
}

export const replaceColumnValues = (
  tables: Record<string, ModelData>,
  tableName: string,
  tree: FieldTree,
  queryData: QueryDataType
) => {
  if (Object.keys(tree).every((v) => v === "__typename")) {
    return {
      columns: {},
      extras: { _: sql`0` },
    };
  }
  const info = tables[tableName]!;
  const columns = info?.columns;
  if (columns) {
    queryData.columns = Object.fromEntries(
      Object.entries(tree).flatMap(([name, value]) =>
        value === true && columns.find((v) => v.name === name) ? [[name, true]] : []
      )
    );
  }
  if (queryData.with) {
    Object.entries(queryData.with).forEach(([name, query]) => {
      if (typeof tree[name] === "object") {
        replaceColumnValues(tables, (query as { _name: string })._name, tree[name], query);
      }
    });
  }
  return queryData;
};

export const getReturning = (info: GraphQLResolveInfo, columns: Column[], primary?: boolean) => {
  const queryFields = getQueryFields(info);
  const isRelay = Object.keys(queryFields).some((v) => !columns.find((c) => c.name === v));
  const returningColumns = columns.filter(
    (v) => queryFields[v.name] || ((primary || isRelay) && v.primary)
  );
  if (!returningColumns.length) return { isRelay, queryFields, returning: undefined };
  const returning = Object.fromEntries(returningColumns.map((v) => [v.name, v]));
  return {
    isRelay,
    queryFields,
    returning,
  };
};
