import { gql } from "@urql/core";
import {
  isInputObjectType,
  validateSchema,
  type GraphQLInputObjectType,
  type GraphQLSchema,
} from "graphql";
import { describe, it, expect } from "vitest";
import { relations } from "../db/relations";
import { createApp, createClient, getSearchPath } from "../libs/test-tools";

const getInputFields = (schema: GraphQLSchema, name: string) => {
  const type = schema.getType(name);
  if (!isInputObjectType(type)) {
    throw new Error(`${name} is not an input object type`);
  }
  return Object.keys((type as GraphQLInputObjectType).getFields());
};

describe("Excluded fields are not filterable or sortable", () => {
  it("removes a column excluded from 'fields' from Where and OrderBy", () => {
    const { schema } = createApp({
      searchPath: getSearchPath(import.meta.url),
      relations,
      pothosDrizzleGenerator: {
        models: {
          posts: {
            fields: () => ({ exclude: ["content"] }),
          },
        },
      },
    });

    expect(getInputFields(schema, "PostWhere")).not.toContain("content");
    expect(getInputFields(schema, "PostOrderBy")).not.toContain("content");

    expect(getInputFields(schema, "PostWhere")).toContain("title");
    expect(getInputFields(schema, "PostOrderBy")).toContain("title");
    expect(validateSchema(schema)).toEqual([]);
  });

  it("removes excluded relations and relation counts from Where and OrderBy", () => {
    const { schema } = createApp({
      searchPath: getSearchPath(import.meta.url),
      relations,
      pothosDrizzleGenerator: {
        models: {
          posts: {
            fields: () => ({ exclude: ["categories", "categoriesCount"] }),
          },
        },
      },
    });

    expect(getInputFields(schema, "PostWhere")).not.toContain("categories");
    expect(getInputFields(schema, "PostWhere")).not.toContain("categoriesCount");
    expect(getInputFields(schema, "PostOrderBy")).not.toContain("categoriesCount");
    expect(getInputFields(schema, "PostWhere")).toContain("author");
  });

  it("keeps a column excluded only from 'inputFields' filterable", () => {
    const { schema } = createApp({
      searchPath: getSearchPath(import.meta.url),
      relations,
      pothosDrizzleGenerator: {
        all: {
          inputFields: () => ({ exclude: ["createdAt"] }),
        },
      },
    });

    expect(getInputFields(schema, "PostCreate")).not.toContain("createdAt");
    expect(getInputFields(schema, "PostWhere")).toContain("createdAt");
    expect(getInputFields(schema, "PostOrderBy")).toContain("createdAt");
  });

  it("omits the orderBy argument when a model has nothing left to sort by", () => {
    const { schema } = createApp({
      searchPath: getSearchPath(import.meta.url),
      relations,
      pothosDrizzleGenerator: {
        models: {
          posts: {
            fields: () => ({ include: ["author"] }),
          },
        },
      },
    });

    expect(schema.getType("PostOrderBy")).toBeUndefined();
    const findManyPost = schema.getQueryType()!.getFields()["findManyPost"]!;
    expect(findManyPost.args.map((a) => a.name)).not.toContain("orderBy");
    expect(findManyPost.args.map((a) => a.name)).toContain("where");
    expect(validateSchema(schema)).toEqual([]);
  });

  it("rejects a filter or ordering over an excluded column, directly and through a relation", async () => {
    const { client } = createClient({
      searchPath: getSearchPath(import.meta.url),
      relations,
      pothosDrizzleGenerator: {
        models: {
          posts: {
            fields: () => ({ exclude: ["content"] }),
          },
        },
      },
    });

    const direct = await client.query(
      gql`
        query {
          findManyPost(where: { content: { like: "a%" } }) {
            id
          }
        }
      `,
      {}
    );
    expect(direct.error?.message).toMatch(/content/);

    const ordered = await client.query(
      gql`
        query {
          findManyPost(orderBy: { content: Asc }) {
            id
          }
        }
      `,
      {}
    );
    expect(ordered.error?.message).toMatch(/content/);

    const throughRelation = await client.query(
      gql`
        query {
          findManyUser(where: { posts: { content: { like: "a%" } } }) {
            id
          }
        }
      `,
      {}
    );
    expect(throughRelation.error?.message).toMatch(/content/);
  });
});
