import { gql } from "@urql/core";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { relations } from "../db/relations";
import { createClient, getSearchPath } from "../libs/test-tools";

const searchPath = getSearchPath(import.meta.url);

/* Unpublished posts are hidden, and so is one user picked in beforeAll. A
   relation filter may not match rows the target model's `where` hides. */
let hiddenUserId = "";

const { client, db } = createClient({
  searchPath,
  relations,
  pothosDrizzleGenerator: {
    models: {
      posts: {
        where: () => ({ published: { eq: true } }),
      },
      users: {
        where: () => ({ id: { ne: hiddenUserId } }),
      },
    },
  },
});

/* No `where` at all, to show the same queries match without one. */
const { client: openClient } = createClient({ searchPath, relations });

/* `posts` cannot be listed, so filtering through it is refused. */
const { client: closedClient } = createClient({
  searchPath,
  relations,
  pothosDrizzleGenerator: {
    models: {
      posts: {
        executable: ({ operation }) => operation !== "findMany",
      },
    },
  },
});

const FIND_MANY_USER = gql`
  query ($where: UserWhere) {
    findManyUser(where: $where) {
      id
    }
  }
`;

const FIND_MANY_POST = gql`
  query ($where: PostWhere) {
    findManyPost(where: $where) {
      id
    }
  }
`;

describe("Relation filters apply the target model's where", () => {
  let hiddenPost: { id: string; authorId: string | null };
  let visiblePost: { id: string; authorId: string | null };

  beforeAll(async () => {
    await db.resetSchema();
    const posts = await db.query.posts.findMany({ where: { authorId: { isNotNull: true } } });
    hiddenPost = posts.find((p) => !p.published)!;
    visiblePost = posts.find((p) => p.published && p.authorId !== hiddenPost.authorId)!;
    // The hidden user writes a published post and is neither of the authors
    // above, so their own rows stay visible to the relation filters on posts.
    const hiddenUserPost = posts.find(
      (p) =>
        p.published &&
        p.authorId !== hiddenPost?.authorId &&
        p.authorId !== visiblePost?.authorId
    );
    if (!hiddenPost || !visiblePost || !hiddenUserPost) {
      throw new Error("Seed has no suitable posts");
    }
    hiddenUserId = hiddenUserPost.authorId!;
  });
  afterAll(async () => {
    await db.dropSchema();
  });

  it("matches a hidden post through a relation filter when nothing is hidden", async () => {
    const result = await openClient.query<{ findManyUser: { id: string }[] }>(FIND_MANY_USER, {
      where: { posts: { id: { eq: hiddenPost.id } } },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.findManyUser.map((u) => u.id)).toContain(hiddenPost.authorId);
  });

  it("does not match a hidden post through a plain relation filter", async () => {
    const result = await client.query<{ findManyUser: { id: string }[] }>(FIND_MANY_USER, {
      where: { posts: { id: { eq: hiddenPost.id } } },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.findManyUser).toEqual([]);
  });

  it("does not match a hidden post through a relation filter of only AND/OR/NOT", async () => {
    for (const filter of [
      { AND: [{ id: { eq: hiddenPost.id } }] },
      { OR: [{ id: { eq: hiddenPost.id } }] },
      { NOT: { id: { ne: hiddenPost.id } } },
    ]) {
      const result = await client.query<{ findManyUser: { id: string }[] }>(FIND_MANY_USER, {
        where: { posts: filter },
      });

      expect(result.error).toBeUndefined();
      expect(result.data?.findManyUser).toEqual([]);
    }
  });

  it("still matches a visible post through a relation filter", async () => {
    const result = await client.query<{ findManyUser: { id: string }[] }>(FIND_MANY_USER, {
      where: { posts: { id: { eq: visiblePost.id } } },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.findManyUser.map((u) => u.id)).toEqual([visiblePost.authorId]);
  });

  it("does not match a hidden author through a one-relation filter", async () => {
    const result = await client.query<{ findManyPost: { id: string }[] }>(FIND_MANY_POST, {
      where: { author: { id: { eq: hiddenUserId } } },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.findManyPost).toEqual([]);
  });

  it("resolves a count filter nested in a relation filter against the target model", async () => {
    const result = await openClient.query<{ findManyPost: { id: string }[] }>(FIND_MANY_POST, {
      where: { author: { postsCount: { gt: 0 } } },
    });

    expect(result.error).toBeUndefined();
    const withAuthor = await db.query.posts.findMany({ where: { authorId: { isNotNull: true } } });
    expect(result.data?.findManyPost).toHaveLength(withAuthor.length);
  });

  it("refuses a relation filter over a model the caller may not list", async () => {
    const result = await closedClient.query(FIND_MANY_USER, {
      where: { posts: { id: { eq: visiblePost.id } } },
    });

    expect(result.error?.message).toMatch(/No permission/);
  });

  it("lists the parent model when no relation filter is used", async () => {
    const result = await closedClient.query<{ findManyUser: { id: string }[] }>(FIND_MANY_USER, {});

    expect(result.error).toBeUndefined();
    expect(result.data?.findManyUser.length).toBeGreaterThan(0);
  });
});
