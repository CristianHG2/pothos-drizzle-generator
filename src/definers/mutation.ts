import { type ModelData, DrizzleGenerator } from "../generator.js";
import { createWhereQuery } from "../libs/drizzle.js";
import { getQueryFields } from "../libs/graphql.js";
import { checkPermissionsAndGetParams } from "../libs/permissions.js";
import {
  buildRelationCountContext,
  getReturning,
  insertRelayValue,
  replaceColumnValues,
  separateInput,
} from "../libs/resolver-helpers.js";
import type { SchemaTypes } from "@pothos/core";
import type { GraphQLResolveInfo } from "graphql";

export function defineCreateOne<Types extends SchemaTypes>(
  builder: PothosSchemaTypes.SchemaBuilder<Types>,
  generator: DrizzleGenerator<Types>,
  modelName: string,
  modelData: ModelData
) {
  const { tableInfo, columns, table, relations, tableSingularAlias, operationAliases } = modelData;
  const inputCreate = generator.getInputCreate(modelName);
  const operationName = operationAliases.createOne ?? `createOne${tableSingularAlias}`;

  builder.mutationType({
    fields: (t) => ({
      [operationName]: t.drizzleField({
        type: modelName,
        nullable: false,
        args: { input: t.arg({ type: inputCreate, required: true }) },
        resolve: async (
          query: (selection: unknown) => unknown,
          _parent: unknown,
          args: { input: object },
          ctx: object,
          info: GraphQLResolveInfo
        ) => {
          const client = generator.getClient(ctx);
          const params = checkPermissionsAndGetParams(modelName, "createOne", ctx, info, modelData);
          const combinedInput = { ...args.input, ...params.input };
          const { dbColumnsInput, relationFieldsInput } = separateInput(combinedInput, columns);
          const hasRelationInput = relationFieldsInput.length > 0;
          const { returning, isRelay } = getReturning(info, columns, hasRelationInput);
          if (!isRelay) {
            query({});
          }
          if (!returning) {
            return client
              .insert(table as never)
              .values(dbColumnsInput as never)
              .then(() => ({}));
          }

          return client.transaction(async (tx) =>
            tx
              .insert(table as never)
              .values(dbColumnsInput as never)
              .returning(returning)
              .then(async (results) => {
                if (hasRelationInput) {
                  await insertRelayValue({
                    results,
                    client: tx,
                    relationInputs: [relationFieldsInput],
                    relations,
                  });
                }
                return results[0];
              })
          );
        },
      } as never),
    }),
  });
}

export function defineCreateMany<Types extends SchemaTypes>(
  builder: PothosSchemaTypes.SchemaBuilder<Types>,
  generator: DrizzleGenerator<Types>,
  modelName: string,
  modelData: ModelData
) {
  const { tableInfo, columns, table, relations, tableSingularAlias, operationAliases } = modelData;
  const inputCreate = generator.getInputCreate(modelName);
  const operationName = operationAliases.createMany ?? `createMany${tableSingularAlias}`;

  builder.mutationType({
    fields: (t) => ({
      [operationName]: t.drizzleField({
        type: [modelName],
        nullable: false,
        args: { input: t.arg({ type: [inputCreate], required: true }) },
        resolve: async (
          query: (selection: unknown) => object,
          _parent: unknown,
          args: { input: object[] },
          ctx: object,
          info: GraphQLResolveInfo
        ) => {
          const client = generator.getClient(ctx);
          const params = checkPermissionsAndGetParams(
            modelName,
            "createMany",
            ctx,
            info,
            modelData
          );
          if (!args.input.length) return [];
          const combinedInputs = args.input.map((v) => ({
            ...v,
            ...params.input,
          }));
          const separatedInputs = combinedInputs.map((input) => separateInput(input, columns));
          const dbColumnsInputs = separatedInputs.map((i) => i.dbColumnsInput);
          const relationFieldsInputs = separatedInputs.map((i) => i.relationFieldsInput);

          const hasRelationInput = relationFieldsInputs.some((v) => v.length > 0);
          const { returning, isRelay } = getReturning(info, columns, hasRelationInput);

          if (!isRelay) {
            query({});
          }
          if (!returning) {
            return client
              .insert(table as never)
              .values(dbColumnsInputs as never)
              .then((v) => Array("rowCount" in v ? v.rowCount : v.rowsAffected).fill({}));
          }
          return client.transaction(async (tx) =>
            tx
              .insert(table as never)
              .values(dbColumnsInputs as never)
              .returning(returning)
              .then(async (results) => {
                if (hasRelationInput) {
                  await insertRelayValue({
                    results,
                    client: tx,
                    relationInputs: relationFieldsInputs,
                    relations,
                  });
                }
                return results;
              })
          );
        },
      } as never),
    }),
  });
}

export function defineUpdate<Types extends SchemaTypes>(
  builder: PothosSchemaTypes.SchemaBuilder<Types>,
  generator: DrizzleGenerator<Types>,
  modelName: string,
  modelData: ModelData,
  tables: Record<string, ModelData>
) {
  const { tableInfo, columns, table, relations, tableSingularAlias, operationAliases } = modelData;
  const inputUpdate = generator.getInputUpdate(modelName);
  const inputWhere = generator.getInputWhere(modelName);
  const operationName = operationAliases.update ?? `update${tableSingularAlias}`;

  builder.mutationType({
    fields: (t) => ({
      [operationName]: t.drizzleField({
        type: [modelName],
        nullable: false,
        args: {
          input: t.arg({ type: inputUpdate, required: true }),
          where: t.arg({ type: inputWhere }),
        },
        resolve: async (
          query: (selection: unknown) => object,
          _parent: unknown,
          args: { input: object; where?: object },
          ctx: object,
          info: GraphQLResolveInfo
        ) => {
          const client = generator.getClient(ctx);
          const params = checkPermissionsAndGetParams(modelName, "update", ctx, info, modelData);
          const combinedInput = { ...args.input, ...params.input };
          const { dbColumnsInput, relationFieldsInput } = separateInput(combinedInput, columns);
          const hasRelationInput = relationFieldsInput.length > 0;
          const { returning, isRelay } = getReturning(info, columns, hasRelationInput);

          if (!isRelay) {
            query({});
          }
          const relationCountContext = buildRelationCountContext(relations, ctx, tables);
          const whereQuery = createWhereQuery(
            table,
            {
              AND: [structuredClone(args.where), params.where].filter((v) => v),
            } as never,
            relationCountContext
          );

          if (!returning) {
            return client
              .update(table as never)
              .set(dbColumnsInput as never)
              .where(whereQuery)
              .then((v) => Array("rowCount" in v ? v.rowCount : v.rowsAffected).fill({}));
          }

          return client.transaction(async (tx) =>
            tx
              .update(table as never)
              .set(dbColumnsInput as never)
              .where(whereQuery)
              .returning(returning)
              .then(async (results) => {
                if (hasRelationInput) {
                  await insertRelayValue({
                    results,
                    client: tx,
                    relationInputs: Array(results.length).fill(relationFieldsInput),
                    relations,
                  });
                }
                return results;
              })
          );
        },
      } as never),
    }),
  });
}

export function defineDelete<Types extends SchemaTypes>(
  builder: PothosSchemaTypes.SchemaBuilder<Types>,
  generator: DrizzleGenerator<Types>,
  modelName: string,
  modelData: ModelData,
  tables: Record<string, ModelData>
) {
  const { tableInfo, columns, table, tableSingularAlias, operationAliases } = modelData;
  const inputWhere = generator.getInputWhere(modelName);
  const operationName = operationAliases.delete ?? `delete${tableSingularAlias}`;

  builder.mutationType({
    fields: (t) => ({
      [operationName]: t.drizzleField({
        type: [modelName],
        nullable: false,
        args: { where: t.arg({ type: inputWhere }) },
        resolve: async (
          query: (selection: unknown) => object,
          _parent: unknown,
          args: { where?: object },
          ctx: object,
          info: GraphQLResolveInfo
        ) => {
          const params = checkPermissionsAndGetParams(modelName, "delete", ctx, info, modelData);
          const { returning, isRelay } = getReturning(info, columns);
          const whereCondition = {
            AND: [structuredClone(args.where), params.where].filter((v) => v),
          };
          const relationCountContext = buildRelationCountContext(
            modelData.relations,
            ctx,
            tables
          );

          if (isRelay) {
            const result = await generator
              .getQueryTable(ctx, modelName)
              .findMany(
                replaceColumnValues(
                  tables,
                  modelName,
                  getQueryFields(info),
                  query({ ...args, where: whereCondition })
                ) as never
              );
            await generator
              .getClient(ctx)
              .delete(table as never)
              .where(createWhereQuery(table, whereCondition as never, relationCountContext));
            return result;
          }

          query({});
          const whereQuery = createWhereQuery(
            table,
            whereCondition as never,
            relationCountContext
          );

          return returning
            ? generator
                .getClient(ctx)
                .delete(table as never)
                .where(whereQuery)
                .returning(returning)
            : generator
                .getClient(ctx)
                .delete(table as never)
                .where(whereQuery)
                .then((v) => Array("rowCount" in v ? v.rowCount : v.rowsAffected).fill({}));
        },
      } as never),
    }),
  });
}