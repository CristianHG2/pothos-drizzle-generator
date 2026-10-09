import * as p from "drizzle-orm";

/**
 * Builds a correlated COUNT(*) subquery SQL for a Drizzle relation.
 *
 * For one-to-many: `(SELECT count(*) FROM target WHERE target.fk = outer.pk [AND whereFilter])`
 * For many-to-many: `(SELECT count(*) FROM target LEFT JOIN through ON ... WHERE through.srcFk = outer.pk [AND whereFilter])`
 *
 * `getOuterColumn(name)` returns a column reference from the outer row's table
 * (i.e. the row being filtered/sorted in the parent query). Pass a column from
 * the outer Drizzle table (see `getColumns(outerTable)[name]` or `outerTable[name]`).
 */
export const createRelationCountSQL = (
  getOuterColumn: (colName: string) => p.Column | p.SQL,
  relay: p.AnyRelation,
  whereFilter?: p.SQL
): p.SQL => {
  if (relay.throughTable) {
    const joinConds = relay.targetColumns.map(
      (tc, i) => p.sql`${relay.through!.target[i]!._.column} = ${tc}`
    );
    const srcConds = relay.sourceColumns.map(
      (src, i) =>
        p.sql`${relay.through!.source[i]!._.column} = ${getOuterColumn(src.name)}`
    );
    const whereParts = [...srcConds, ...(whereFilter ? [whereFilter] : [])];
    return p.sql`(SELECT count(*) FROM ${relay.targetTable} LEFT JOIN ${relay.throughTable} ON ${p.sql.join(joinConds, p.sql` AND `)} WHERE ${p.sql.join(whereParts, p.sql` AND `)})`;
  }

  const conds = relay.sourceColumns.map(
    (src, i) => p.sql`${relay.targetColumns[i]!} = ${getOuterColumn(src.name)}`
  );
  const whereParts = [...conds, ...(whereFilter ? [whereFilter] : [])];
  return p.sql`(SELECT count(*) FROM ${relay.targetTable} WHERE ${p.sql.join(whereParts, p.sql` AND `)})`;
};

const OperatorMap = {
  eq: p.eq,
  ne: p.ne,
  gt: p.gt,
  gte: p.gte,
  lt: p.lt,
  lte: p.lte,
  like: p.like,
  notLike: p.notLike,
  ilike: p.ilike,
  notIlike: p.notIlike,
  isNull: p.isNull,
  isNotNull: p.isNotNull,
  in: p.inArray,
  notIn: p.notInArray,
  arrayContained: p.arrayContained,
  arrayOverlaps: p.arrayOverlaps,
  arrayContains: p.arrayContains,
  contains: (column: p.Column | p.SQL, value: unknown) =>
    p.sql`${column} @> ${JSON.stringify(value)}::jsonb`,
  containedBy: (column: p.Column | p.SQL, value: unknown) =>
    p.sql`${column} <@ ${JSON.stringify(value)}::jsonb`,
  hasKey: (column: p.Column | p.SQL, value: string) =>
    p.sql`jsonb_exists(${column}, ${value})`,
  hasAnyKeys: (column: p.Column | p.SQL, value: string[]) =>
    p.sql`jsonb_exists_any(${column}, array[${p.sql.join(
      value.map((v) => p.sql`${v}`),
      p.sql`, `
    )}])`,
  hasAllKeys: (column: p.Column | p.SQL, value: string[]) =>
    p.sql`jsonb_exists_all(${column}, array[${p.sql.join(
      value.map((v) => p.sql`${v}`),
      p.sql`, `
    )}])`,
};

type PartialRecord<K extends PropertyKey, T> = {
  [P in K]?: T;
};

type OperatorType = PartialRecord<string, PartialRecord<keyof typeof OperatorMap, unknown>>;
type OperatorTree =
  | PartialRecord<"AND" | "OR", OperatorTree[]>
  | { NOT?: OperatorTree }
  | OperatorType;

/**
 * Optional context for `createWhereQuery` that enables `${relationName}Count`
 * filter keys. Keys present in `relations` with a matching `${name}Count` entry
 * in the where tree are compiled to correlated COUNT(*) subqueries via
 * `createRelationCountSQL`. `relationPermissionsSQL` is an optional map keyed
 * by relation name that injects a permissions-level WHERE filter into the
 * count subquery for that relation.
 */
export type CreateWhereQueryContext = {
  relations: p.RelationsRecord;
  relationPermissionsSQL?: { get: (relationName: string) => p.SQL | undefined };
};

export const createWhereQuery = (
  table: p.SchemaEntry,
  tree?: OperatorTree,
  context?: CreateWhereQueryContext
): p.SQL | undefined => {
  if (!tree) return undefined;
  const result: p.SQL[] = Object.entries(tree)
    .map(([key, value]) => {
      switch (key) {
        case "AND":
          return value.length
            ? p.and(...value.map((v: OperatorTree) => createWhereQuery(table, v, context)))
            : undefined;
        case "OR":
          return value.length
            ? p.or(...value.map((v: OperatorTree) => createWhereQuery(table, v, context)))
            : undefined;
        case "NOT": {
          const v = createWhereQuery(table, value, context);
          return v ? p.not(v) : undefined;
        }
      }

      // Handle `${relationName}Count` filter keys
      if (context && key.endsWith("Count")) {
        const relName = key.slice(0, -"Count".length);
        const relay = context.relations[relName];
        if (relay && relay.relationType === "many" && typeof value === "object" && value) {
          const outerCols = p.getColumns(table);
          const permSQL = context.relationPermissionsSQL?.get(relName);
          const countSQL = createRelationCountSQL(
            (name) => outerCols[name] as p.Column,
            relay,
            permSQL
          );
          const ops = Object.entries(value).map(([k, v]) => {
            const op = OperatorMap[k as keyof typeof OperatorMap];
            return (op as (column: p.SQL | p.Column, value: unknown) => p.SQL)(
              countSQL,
              v
            ) as p.SQL;
          });
          if (ops.length === 0) return undefined;
          if (ops.length === 1) return ops[0] as p.SQL;
          return p.and(...ops);
        }
      }

      const column = p.getColumns(table)[key];
      if (!column) {
        throw new Error(
          `createWhereQuery: "${key}" is not a column of this table; relation filters cannot be compiled here`
        );
      }
      const result =
        typeof value === "object"
          ? Object.entries(value).map(([k, v]) => {
              const op = OperatorMap[k as keyof typeof OperatorMap];
              if (!op) {
                throw new Error(`createWhereQuery: unknown operator "${k}" on "${key}"`);
              }
              return (op as (column: p.SQL | p.Column, value: unknown) => p.SQL)(
                column,
                v
              ) as p.SQL;
            })
          : [p.eq(column, value)];
      if (result.length === 1) {
        return result[0] as p.SQL;
      }
      return p.and(...result);
    })
    .flatMap((v) => (v ? [v] : []));
  if (result.length === 1) return result[0] as p.SQL;
  return p.and(...result);
};
