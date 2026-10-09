import { sql } from "drizzle-orm";
import { type ModelData, DrizzleGenerator } from "../generator.js";
import { getQueryFields } from "../libs/graphql.js";
import { checkPermissionsAndGetParams } from "../libs/permissions.js";
import {
  buildRelationCountContext,
  prepareQueryOptions,
  replaceColumnValues,
  transformWhereForRelationalQuery,
} from "../libs/resolver-helpers.js";
import type { SchemaTypes } from "@pothos/core";
import type { GraphQLResolveInfo } from "graphql";

type QueryArgs = {
  offset?: number;
  limit?: number;
  where?: object;
  orderBy?: object[];
};

export function defineFindMany<Types extends SchemaTypes>(
  builder: PothosSchemaTypes.SchemaBuilder<Types>,
  generator: DrizzleGenerator<Types>,
  modelName: string,
  modelData: ModelData,
  tables: Record<string, ModelData>
) {
  const { tableSingularAlias, operationAliases } = modelData;
  const inputWhere = generator.getInputWhere(modelName);
  const inputOrderBy = generator.getInputOrderBy(modelName);
  const operationName = operationAliases.findMany ?? `findMany${tableSingularAlias}`;

  builder.queryType({
    fields: (t) => ({
      [operationName]: t.drizzleField({
        type: [modelName],
        nullable: false,
        args: {
          offset: t.arg({ type: "Int" }),
          limit: t.arg({ type: "Int" }),
          where: t.arg({ type: inputWhere }),
          ...(inputOrderBy ? { orderBy: t.arg({ type: [inputOrderBy] }) } : {}),
        },
        resolve: async (
          query: (selection: unknown) => object,
          _parent: unknown,
          args: QueryArgs,
          ctx: object,
          info: GraphQLResolveInfo
        ) => {
          const params = checkPermissionsAndGetParams(modelName, "findMany", ctx, info, modelData);
          const relationCountContext = buildRelationCountContext(
            modelData.relations,
            ctx,
            tables
          );
          const queryOptions = prepareQueryOptions(args, params, true, relationCountContext);

          return generator
            .getQueryTable(ctx, modelName)
            .findMany(
              replaceColumnValues(
                tables,
                modelName,
                getQueryFields(info),
                query(queryOptions)
              ) as never
            );
        },
      } as never),
    }),
  });
}

export function defineFindFirst<Types extends SchemaTypes>(
  builder: PothosSchemaTypes.SchemaBuilder<Types>,
  generator: DrizzleGenerator<Types>,
  modelName: string,
  modelData: ModelData,
  tables: Record<string, ModelData>
) {
  const { tableSingularAlias, operationAliases } = modelData;
  const inputWhere = generator.getInputWhere(modelName);
  const inputOrderBy = generator.getInputOrderBy(modelName);
  const operationName = operationAliases.findFirst ?? `findFirst${tableSingularAlias}`;

  builder.queryType({
    fields: (t) => ({
      [operationName]: t.drizzleField({
        type: modelName,
        args: {
          offset: t.arg({ type: "Int" }),
          where: t.arg({ type: inputWhere }),
          ...(inputOrderBy ? { orderBy: t.arg({ type: [inputOrderBy] }) } : {}),
        },
        resolve: async (
          query: (selection: unknown) => object,
          _parent: unknown,
          args: QueryArgs,
          ctx: object,
          info: GraphQLResolveInfo
        ) => {
          const params = checkPermissionsAndGetParams(modelName, "findFirst", ctx, info, modelData);
          const relationCountContext = buildRelationCountContext(
            modelData.relations,
            ctx,
            tables
          );
          const queryOptions = prepareQueryOptions(args, params, false, relationCountContext);

          return generator
            .getQueryTable(ctx, modelName)
            .findFirst(
              replaceColumnValues(
                tables,
                modelName,
                getQueryFields(info),
                query(queryOptions)
              ) as never
            );
        },
      } as never),
    }),
  });
}

export function defineCount<Types extends SchemaTypes>(
  builder: PothosSchemaTypes.SchemaBuilder<Types>,
  generator: DrizzleGenerator<Types>,
  modelName: string,
  modelData: ModelData,
  tables: Record<string, ModelData>
) {
  const { operationAliases, tableSingularAlias } = modelData;
  const inputWhere = generator.getInputWhere(modelName);
  const operationName = operationAliases.count ?? `count${tableSingularAlias}`;

  builder.queryType({
    fields: (t) => ({
      [operationName]: t.field({
        type: "Int",
        nullable: false,
        args: {
          limit: t.arg({ type: "Int" }),
          where: t.arg({ type: inputWhere }),
        },
        resolve: async (
          _parent: unknown,
          args: { where?: object },
          ctx: object,
          info: GraphQLResolveInfo
        ) => {
          const params = checkPermissionsAndGetParams(modelName, "count", ctx, info, modelData);
          const relationCountContext = buildRelationCountContext(
            modelData.relations,
            ctx,
            tables
          );

          return generator
            .getQueryTable(ctx, modelName)
            .findFirst({
              columns: {},
              extras: { _count: () => sql`count(*) ` },
              ...args,
              where: transformWhereForRelationalQuery(
                {
                  AND: [structuredClone(args.where), params.where].filter((v) => v),
                },
                relationCountContext
              ),
            } as never)
            .then((v: unknown) => (v as { _count: number })._count);
        },
      } as never),
    }),
  });
}