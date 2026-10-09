import { BasePlugin, type BuildCache, type SchemaTypes } from "@pothos/core";
import { defineModelObject } from "./definers/model.js";
import {
  defineCreateOne,
  defineCreateMany,
  defineUpdate,
  defineDelete,
} from "./definers/mutation.js";
import { defineFindMany, defineFindFirst, defineCount } from "./definers/query.js";
import { DrizzleGenerator, type ModelData } from "./generator.js";

export class PothosDrizzleGenerator<
  Types extends SchemaTypes,
  T extends object = object,
> extends BasePlugin<Types, T> {
  generator: DrizzleGenerator<Types>;

  constructor(buildCache: BuildCache<Types>, name: keyof PothosSchemaTypes.Plugins<Types>) {
    super(buildCache, name);
    this.generator = new DrizzleGenerator(this.builder);
  }

  beforeBuild(): void {
    const generator = this.generator;
    const tables = generator.getTables();

    for (const [modelName, modelData] of Object.entries(tables)) {
      defineModelObject(this.builder, generator, modelName, modelData, tables);
      this.defineOperations(modelName, modelData, tables);
    }
  }

  private defineOperations(
    modelName: string,
    modelData: ModelData,
    tables: Record<string, ModelData>
  ) {
    const { operations } = modelData;
    const builder = this.builder;
    const generator = this.generator;

    if (operations.includes("findMany")) {
      defineFindMany(builder, generator, modelName, modelData, tables);
    }
    if (operations.includes("findFirst")) {
      defineFindFirst(builder, generator, modelName, modelData, tables);
    }
    if (operations.includes("count")) {
      defineCount(builder, generator, modelName, modelData, tables);
    }
    if (operations.includes("createOne")) {
      defineCreateOne(builder, generator, modelName, modelData);
    }
    if (operations.includes("createMany")) {
      defineCreateMany(builder, generator, modelName, modelData);
    }
    if (operations.includes("update")) {
      defineUpdate(builder, generator, modelName, modelData, tables);
    }
    if (operations.includes("delete")) {
      defineDelete(builder, generator, modelName, modelData, tables);
    }
  }
}
