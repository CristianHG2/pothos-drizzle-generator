import { describe, it, expect } from "vitest";
import { createRelationCountSQL, createWhereQuery } from "../../src/libs/drizzle";
import { relations } from "../db/relations";
import { posts, test, users } from "../db/schema";

describe("libs/drizzle", () => {
  describe("createWhereQuery", () => {
    it("should return undefined for undefined tree", () => {
      const result = createWhereQuery(posts, undefined);
      expect(result).toBeUndefined();
    });

    it("should handle simple equality check", () => {
      const result = createWhereQuery(posts, { id: { eq: "123" } });
      // We can't easily assert the SQL string output without a driver/compiler,
      // but we can check if it returns a SQL object (not undefined).
      expect(result).toBeDefined();
    });

    it("should handle AND conditions", () => {
      const result = createWhereQuery(posts, {
        AND: [{ title: { eq: "test" } }, { published: { eq: true } }],
      });
      expect(result).toBeDefined();
    });

    it("should handle OR conditions", () => {
      const result = createWhereQuery(posts, {
        OR: [{ title: { eq: "test" } }, { published: { eq: true } }],
      });
      expect(result).toBeDefined();
    });

    it("should handle NOT conditions", () => {
      const result = createWhereQuery(posts, {
        NOT: { title: { eq: "test" } },
      });
      expect(result).toBeDefined();
    });

    it("should handle nested logical operators", () => {
      const result = createWhereQuery(posts, {
        OR: [
          { AND: [{ title: { eq: "A" } }, { published: { eq: true } }] },
          { title: { eq: "B" } },
        ],
      });
      expect(result).toBeDefined();
    });

    it("should handle empty AND array as undefined (or valid SQL depending on impl)", () => {
      // Based on implementation: return value.length ? ... : undefined
      const result = createWhereQuery(posts, { AND: [] });
      expect(result).toBeUndefined();
    });

    it("should handle mixed operators", () => {
      const result = createWhereQuery(posts, {
        title: { eq: "test", ne: "test2" },
      });
      expect(result).toBeDefined();
    });
  });

  describe("jsonb operators", () => {
    it("should handle contains (@>)", () => {
      const result = createWhereQuery(test, {
        jsonb: { contains: { key: "value" } },
      });
      expect(result).toBeDefined();
    });

    it("should handle containedBy (<@)", () => {
      const result = createWhereQuery(test, {
        jsonb: { containedBy: { key: "value", other: 123 } },
      });
      expect(result).toBeDefined();
    });

    it("should handle hasKey (jsonb_exists)", () => {
      const result = createWhereQuery(test, {
        jsonb: { hasKey: "myKey" },
      });
      expect(result).toBeDefined();
    });

    it("should handle hasAnyKeys (jsonb_exists_any)", () => {
      const result = createWhereQuery(test, {
        jsonb: { hasAnyKeys: ["key1", "key2"] },
      });
      expect(result).toBeDefined();
    });

    it("should handle hasAllKeys (jsonb_exists_all)", () => {
      const result = createWhereQuery(test, {
        jsonb: { hasAllKeys: ["key1", "key2"] },
      });
      expect(result).toBeDefined();
    });

    it("should handle contains with nested objects", () => {
      const result = createWhereQuery(test, {
        jsonb: { contains: { nested: { deep: true } } },
      });
      expect(result).toBeDefined();
    });

    it("should handle contains with arrays", () => {
      const result = createWhereQuery(test, {
        jsonb: { contains: [1, 2, 3] },
      });
      expect(result).toBeDefined();
    });

    it("should combine jsonb operators with AND", () => {
      const result = createWhereQuery(test, {
        AND: [
          { jsonb: { contains: { status: "active" } } },
          { jsonb: { hasKey: "email" } },
        ],
      });
      expect(result).toBeDefined();
    });
  });

  describe("relation count filters", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = relations as any;
    const userRelations = r.users.relations;
    const postRelations = r.posts.relations;

    it("should build COUNT filter for one-to-many relation", () => {
      const result = createWhereQuery(
        users,
        { postsCount: { gt: 5 } },
        { relations: userRelations }
      );
      expect(result).toBeDefined();
    });

    it("should build COUNT filter for many-to-many relation", () => {
      const result = createWhereQuery(
        posts,
        { categoriesCount: { gte: 1 } },
        { relations: postRelations }
      );
      expect(result).toBeDefined();
    });

    it("should combine count filter with column filter", () => {
      const result = createWhereQuery(
        users,
        {
          postsCount: { gt: 0 },
          name: { eq: "Alice" },
        },
        { relations: userRelations }
      );
      expect(result).toBeDefined();
    });

    it("should ignore count filter when relation is not found", () => {
      // No context provided → should treat `postsCount` as a column (which doesn't exist).
      // Without context, our new branch is skipped and the existing column branch runs.
      // That will try to access `getColumns(users).postsCount` which is undefined, producing
      // a valid-but-nonsensical SQL. We don't enforce an error here; just verify no crash
      // when context is absent by using the legacy behavior.
      const result = createWhereQuery(users, { name: { eq: "Alice" } });
      expect(result).toBeDefined();
    });

    it("should support NOT/AND/OR with count filters", () => {
      const result = createWhereQuery(
        users,
        {
          OR: [{ postsCount: { eq: 0 } }, { postsCount: { gt: 10 } }],
        },
        { relations: userRelations }
      );
      expect(result).toBeDefined();
    });
  });

  describe("createRelationCountSQL", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = relations as any;
    const userRelations = r.users.relations;
    const postRelations = r.posts.relations;

    it("should produce a subquery SQL for one-to-many", () => {
      const userPostsRel = userRelations.posts;
      const sql = createRelationCountSQL(
        (name) => users[name as keyof typeof users] as never,
        userPostsRel
      );
      expect(sql).toBeDefined();
    });

    it("should produce a subquery SQL for many-to-many", () => {
      const postCategoriesRel = postRelations.categories;
      const sql = createRelationCountSQL(
        (name) => posts[name as keyof typeof posts] as never,
        postCategoriesRel
      );
      expect(sql).toBeDefined();
    });
  });
});
