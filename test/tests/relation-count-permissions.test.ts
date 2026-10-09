import { gql } from "@urql/core";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { relations } from "../db/relations";
import { createClient, getSearchPath } from "../libs/test-tools";

const searchPath = getSearchPath(import.meta.url);

/* `posts` can be listed but not counted. That may not affect a query on
   `users` that counts nothing. */
const { client, db } = createClient({
  searchPath,
  relations,
  pothosDrizzleGenerator: {
    models: {
      posts: {
        executable: ({ operation }) => operation !== "count",
      },
    },
  },
});

/* `posts` carries a `where` with a relation filter, which the count subquery's
   SQL builder cannot compile. That may not affect a query on `users` that
   counts nothing either. */
const { client: relationFilterClient } = createClient({
  searchPath,
  relations,
  pothosDrizzleGenerator: {
    models: {
      posts: {
        where: () => ({ author: { name: { isNotNull: true } } }),
      },
    },
  },
});

describe("Relation count permissions are resolved only when a count is used", () => {
  beforeAll(async () => {
    await db.resetSchema();
  });
  afterAll(async () => {
    await db.dropSchema();
  });

  it("lists the parent model when nothing is counted", async () => {
    const dbCount = (await db.query.users.findMany()).length;

    const result = await client.query<{ findManyUser: { id: string }[] }>(
      gql`
        query {
          findManyUser {
            id
          }
        }
      `,
      {}
    );

    expect(result.error).toBeUndefined();
    expect(result.data?.findManyUser).toHaveLength(dbCount);
  });

  it("finds the first parent and counts parents when nothing is counted", async () => {
    const result = await client.query<{ findFirstUser: { id: string }; countUser: number }>(
      gql`
        query {
          findFirstUser {
            id
          }
          countUser
        }
      `,
      {}
    );

    expect(result.error).toBeUndefined();
    expect(result.data?.findFirstUser.id).toBeDefined();
  });

  it("lists the parent model when a counted relation's where has a relation filter", async () => {
    const dbCount = (await db.query.users.findMany()).length;

    const result = await relationFilterClient.query<{ findManyUser: { id: string }[] }>(
      gql`
        query {
          findManyUser {
            id
          }
        }
      `,
      {}
    );

    expect(result.error).toBeUndefined();
    expect(result.data?.findManyUser).toHaveLength(dbCount);
  });

  it("still refuses a count filter over a relation the caller may not count", async () => {
    const result = await client.query(
      gql`
        query {
          findManyUser(where: { postsCount: { gt: 0 } }) {
            id
          }
        }
      `,
      {}
    );

    expect(result.error?.message).toMatch(/No permission/);
  });
});
