import { and, eq, sql, type AnyRelation, type Table } from "drizzle-orm";
import { type ModelData, DrizzleGenerator } from "../generator.js";
import { createWhereQuery } from "../libs/drizzle.js";
import { checkPermissionsAndGetParams } from "../libs/permissions.js";
import {
  buildRelationCountContext,
  transformWhereForRelationalQuery,
} from "../libs/resolver-helpers.js";
import type { SchemaTypes } from "@pothos/core";
import type { DrizzleObjectFieldBuilder } from "@pothos/plugin-drizzle";

export function defineModelObject<Types extends SchemaTypes>(
  builder: PothosSchemaTypes.SchemaBuilder<Types>,
  generator: DrizzleGenerator<Types>,
  modelName: string,
  modelData: ModelData,
  tables: Record<string, ModelData>
) {
  const { tableInfo, relations, columns, filterColumns, tableSingularAlias } = modelData;

  const filterRelations = Object.entries(relations).filter(
    ([, relay]) => tables[relay.targetTableName]
  );

  builder.drizzleObject(modelName as never, {
    name: tableSingularAlias,
    fields: (t) => {
      const relayList = filterRelations
        .filter(([name]) => filterColumns.includes(name))
        .map(([relayName, relay]) => createRelationField(t, generator, relayName, relay, tables));

      const relayCount = filterRelations
        .filter(([name]) => filterColumns.includes(`${name}Count`))
        .map(([relayName, relay]) =>
          createRelationCountField(t, generator, relayName, relay, tables)
        );
      const columnList = columns
        .filter(({ name }) => filterColumns.includes(name))
        .map((c) => [
          c.name,
          t.expose(c.name, {
            type: generator.getDataType(c),
            nullable: !c.notNull,
          } as never),
        ]);

      return Object.fromEntries([...relayCount, ...relayList, ...columnList]);
    },
  });
}

function createRelationField<Types extends SchemaTypes, Shape>(
  t: DrizzleObjectFieldBuilder<Types, Types["DrizzleRelations"][string], Shape>,
  generator: DrizzleGenerator<Types>,
  relayName: string,
  relay: AnyRelation,
  tables: Record<string, ModelData>
) {
  const targetModelName = relay.targetTableName;
  const { operations } = tables[targetModelName]!;
  const operation = relay.relationType === "one" ? "findFirst" : "findMany";

  if (!operations.includes(operation)) return [];

  const inputWhere = generator.getInputWhere(targetModelName);
  const inputOrderBy = generator.getInputOrderBy(targetModelName);

  return [
    relayName,
    t.relation(relayName, {
      nullable: relay.relationType === "one",
      args: {
        offset: t.arg({ type: "Int" }),
        limit: t.arg({ type: "Int" }),
        where: t.arg({ type: inputWhere }),
        ...(inputOrderBy ? { orderBy: t.arg({ type: [inputOrderBy] }) } : {}),
      },
      query: (
        args: {
          where?: object;
          offset?: number;
          limit?: number;
          orderBy?: object[];
        },
        ctx: object
      ) => {
        const params = checkPermissionsAndGetParams(
          targetModelName,
          operation,
          ctx,
          null,
          tables[targetModelName]!
        );
        const targetRelationCountContext = buildRelationCountContext(
          tables[targetModelName]!.relations,
          ctx,
          tables
        );

        return {
          ...args,
          _name: targetModelName,
          limit:
            params.limit && args.limit
              ? Math.min(params.limit, args.limit)
              : (params.limit ?? args.limit),
          where: transformWhereForRelationalQuery(
            {
              AND: [structuredClone(args.where), params.where].filter((v) => v),
            },
            targetRelationCountContext
          ),
          orderBy:
            args.orderBy && Object.keys(args.orderBy).length
              ? Object.fromEntries(args.orderBy.flatMap((v) => Object.entries(v)))
              : params.orderBy,
        };
      },
    } as never),
  ];
}

function createRelationCountField<Types extends SchemaTypes, Shape>(
  t: DrizzleObjectFieldBuilder<Types, Types["DrizzleRelations"][string], Shape>,
  generator: DrizzleGenerator<Types>,
  relayName: string,
  relay: AnyRelation,
  tables: Record<string, ModelData>
) {
  const targetModelName = relay.targetTableName;
  const operation = "count";
  const { operations } = tables[targetModelName]!;

  if (!operations.includes(operation)) return [];

  const inputWhere = generator.getInputWhere(targetModelName);

  if (relay.throughTable) {
    return [
      `${relayName}Count`,
      t.field({
        type: "Int",
        nullable: false,
        args: { where: t.arg({ type: inputWhere }) },
        extensions: {
          pothosDrizzleSelect: (args: { where?: object }, ctx: object) => {
            const params = checkPermissionsAndGetParams(
              targetModelName,
              operation,
              ctx,
              null,
              tables[targetModelName]!
            );

            return {
              columns: {},
              extras: {
                [`${relayName}Count`]: (table: Table) => {
                  const client = generator.getClient(ctx);
                  return client
                    .select({ count: sql`count(*)` })
                    .from(relay.targetTable as never)
                    .leftJoin(
                      relay.throughTable as never,
                      and(
                        ...relay.targetColumns.map((v, index) =>
                          eq(relay.through!.target[index]!._.column, v)
                        )
                      )
                    )
                    .where(
                      and(
                        ...relay.sourceColumns.map((v, index) =>
                          eq(
                            relay.through!.source[index]!._.column,
                            table[v.name as keyof typeof table]
                          )
                        ),
                        createWhereQuery(
                          relay.targetTable,
                          {
                            AND: [structuredClone(args.where), params.where].filter((v) => v),
                          } as never,
                          buildRelationCountContext(
                            tables[targetModelName]!.relations,
                            ctx,
                            tables
                          )
                        )
                      )
                    );
                },
              },
            };
          },
        },
      } as never),
    ];
  } else {
    return [
      `${relayName}Count`,
      t.relatedCount(relayName, {
        args: { where: t.arg({ type: inputWhere }) },
        where: (args: { limit?: number; where?: object }, ctx: object) => {
          const params = checkPermissionsAndGetParams(
            targetModelName,
            operation,
            ctx,
            null,
            tables[targetModelName]!
          );
          return createWhereQuery(
            relay.targetTable,
            {
              AND: [structuredClone(args.where), params.where].filter((v) => v),
            } as never,
            buildRelationCountContext(tables[targetModelName]!.relations, ctx, tables)
          );
        },
      } as never),
    ];
  }
}
