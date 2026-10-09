import { eq } from "drizzle-orm";
import { gql } from "@urql/core";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { relations } from "../db/relations";
import { posts, postsToCategories } from "../db/schema";
import { createClient, filterObject, getSearchPath } from "../libs/test-tools";

export const { app, client, db } = createClient({
  searchPath: getSearchPath(import.meta.url),
  relations,
  pothosDrizzleGenerator: {},
});


const FIND_MANY_POST = gql`
  fragment post on Post {
    id
    title
    content
    published
    authorId
  }
  fragment user on User {
    id
    email
    name
    roles
    createdAt
    updatedAt
  }
  fragment category on Category {
    id
    name
    createdAt
    updatedAt
  }
  query FindManyPost(
    $offset: Int
    $limit: Int
    $where: PostWhere
    $orderBy: [PostOrderBy!]
    $authorCountWhere: UserWhere
    $categoriesCountWhere: CategoryWhere
    $authorOffset: Int
    $authorLimit: Int
    $authorWhere: UserWhere
    $authorOrderBy: [UserOrderBy!]
    $categoriesOffset: Int
    $categoriesLimit: Int
    $categoriesWhere: CategoryWhere
    $categoriesOrderBy: [CategoryOrderBy!]
  ) {
    findManyPost(offset: $offset, limit: $limit, where: $where, orderBy: $orderBy) {
      ...post
      authorCount(where: $authorCountWhere)
      categoriesCount(where: $categoriesCountWhere)
      author(
        offset: $authorOffset
        limit: $authorLimit
        where: $authorWhere
        orderBy: $authorOrderBy
      ) {
        ...user
      }
      categories(
        offset: $categoriesOffset
        limit: $categoriesLimit
        where: $categoriesWhere
        orderBy: $categoriesOrderBy
      ) {
        ...category
      }
    }
  }
`;

interface PostResponse {
  id: string;
  title: string;
  content: string;
  published: boolean;
  authorId: string;
  author: {
    id: string;
    name: string;
  };
  categories: { id: string; name: string }[];
}

describe("Query: findManyPost (Drizzle v2 Pure Object Syntax)", () => {
  const IGNORED_KEYS = ["id", "createdAt", "updatedAt", "publishedAt"];

  beforeAll(async () => {
    await db.resetSchema();
  });
  afterAll(async () => {
    await db.dropSchema();
  });
  it("should retrieve posts using object-based where clause", async () => {
    
    const allPosts = await db.query.posts.findMany({
      limit: 5,
      where: {
        id: { isNotNull: true },
      },
    });

    if (allPosts.length === 0) throw new Error("No posts found in database");

    const result = await client.query<{ findManyPost: PostResponse[] }>(FIND_MANY_POST, {
      where: {
        id: { in: allPosts.map((p) => p.id) },
      },
      orderBy: [{ title: "Asc" }],
    });

    expect(result.error).toBeUndefined();
    const data = result.data?.findManyPost;

    if (!data) throw new Error("Query result data is missing");

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(allPosts.length);
    expect(filterObject(data[0], IGNORED_KEYS)).toMatchSnapshot();
  });

  it("should filter posts by published status using pure object syntax", async () => {
    const result = await client.query<{ findManyPost: PostResponse[] }>(FIND_MANY_POST, {
      where: {
        published: { eq: true },
      },
    });

    const data = result.data?.findManyPost;
    if (!data) throw new Error("No data returned");

    data.forEach((post) => {
      expect(post.published).toBe(true);
    });
  });

  it("should handle pagination with limit and offset", async () => {
    const limit = 2;
    const result = await client.query<{ findManyPost: PostResponse[] }>(FIND_MANY_POST, {
      limit,
      offset: 0,
      orderBy: [{ createdAt: "Desc" }],
    });

    expect(result.data?.findManyPost.length).toBeLessThanOrEqual(limit);
  });

  it("should handle complex 'and' conditions via object keys", async () => {
    const targetPost = await db.query.posts.findFirst();
    if (!targetPost) throw new Error("Data required");

    const result = await client.query<{ findManyPost: PostResponse[] }>(FIND_MANY_POST, {
      where: {
        authorId: { eq: targetPost.authorId },
        published: { eq: targetPost.published },
      },
    });

    const data = result.data?.findManyPost;
    expect(
      data?.every((p) => p.authorId === targetPost.authorId && p.published === targetPost.published)
    ).toBe(true);
  });

  it("should return an empty array for non-matching pure object criteria", async () => {
    const result = await client.query<{ findManyPost: PostResponse[] }>(FIND_MANY_POST, {
      where: {
        title: { eq: "NON_EXISTENT_TITLE_UNIQUE_999" },
      },
    });

    expect(result.data?.findManyPost).toHaveLength(0);
  });

  it("should filter by jsonb contains operator", async () => {
    const targetPosts = await db.query.posts.findMany({ limit: 2 });
    if (targetPosts.length < 2) throw new Error("Need at least 2 posts");

    await db
      .update(posts)
      .set({ metadata: { category: "jsonb_test", level: 1 } })
      .where(eq(posts.id, targetPosts[0]!.id));
    await db
      .update(posts)
      .set({ metadata: { category: "jsonb_test", level: 2 } })
      .where(eq(posts.id, targetPosts[1]!.id));

    const result = await client.query<{ findManyPost: PostResponse[] }>(FIND_MANY_POST, {
      where: {
        metadata: { contains: { category: "jsonb_test" } },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.findManyPost.length).toBeGreaterThanOrEqual(2);
    const returnedIds = result.data?.findManyPost.map((p) => p.id);
    expect(returnedIds).toContain(targetPosts[0]!.id);
    expect(returnedIds).toContain(targetPosts[1]!.id);
  });

  it("should filter by jsonb hasKey operator", async () => {
    const post = await db.query.posts.findFirst();
    if (!post) throw new Error("Post required");

    await db
      .update(posts)
      .set({ metadata: { unique_marker: true } })
      .where(eq(posts.id, post.id));

    const result = await client.query<{ findManyPost: PostResponse[] }>(FIND_MANY_POST, {
      where: {
        metadata: { hasKey: "unique_marker" },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.findManyPost.length).toBeGreaterThanOrEqual(1);
    expect(result.data?.findManyPost.map((p) => p.id)).toContain(post.id);
  });

  it("should filter by jsonb containedBy operator", async () => {
    const post = await db.query.posts.findFirst();
    if (!post) throw new Error("Post required");

    await db
      .update(posts)
      .set({ metadata: { color: "blue" } })
      .where(eq(posts.id, post.id));

    const result = await client.query<{ findManyPost: PostResponse[] }>(FIND_MANY_POST, {
      where: {
        metadata: { containedBy: { color: "blue", size: "large", weight: 10 } },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.findManyPost.length).toBeGreaterThanOrEqual(1);
    expect(result.data?.findManyPost.map((p) => p.id)).toContain(post.id);
  });

  it("should filter by jsonb hasAnyKeys operator", async () => {
    const post = await db.query.posts.findFirst();
    if (!post) throw new Error("Post required");

    await db
      .update(posts)
      .set({ metadata: { gamma: 1 } })
      .where(eq(posts.id, post.id));

    const result = await client.query<{ findManyPost: PostResponse[] }>(FIND_MANY_POST, {
      where: {
        metadata: { hasAnyKeys: ["gamma", "delta"] },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.findManyPost.length).toBeGreaterThanOrEqual(1);
    expect(result.data?.findManyPost.map((p) => p.id)).toContain(post.id);
  });

  it("should filter by jsonb hasAllKeys operator", async () => {
    const post = await db.query.posts.findFirst();
    if (!post) throw new Error("Post required");

    await db
      .update(posts)
      .set({ metadata: { keyX: 1, keyY: 2 } })
      .where(eq(posts.id, post.id));

    const result = await client.query<{ findManyPost: PostResponse[] }>(FIND_MANY_POST, {
      where: {
        metadata: { hasAllKeys: ["keyX", "keyY"] },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.findManyPost.length).toBeGreaterThanOrEqual(1);
    expect(result.data?.findManyPost.map((p) => p.id)).toContain(post.id);
  });

  it("should filter by multiple IDs using 'in' operator in object", async () => {
    const targetPosts = await db.query.posts.findMany({ limit: 2 });
    const targetIds = targetPosts.map((p) => p.id);

    const result = await client.query<{ findManyPost: PostResponse[] }>(FIND_MANY_POST, {
      where: {
        id: { in: targetIds },
      },
    });

    expect(result.data?.findManyPost).toHaveLength(targetIds.length);
    result.data?.findManyPost.forEach((post) => {
      expect(targetIds).toContain(post.id);
    });
  });

  it("should filter posts by categoriesCount (many-to-many)", async () => {
    // Seed: attach every category to the first post so it has a positive count.
    const cats = await db.query.categories.findMany();
    const firstPost = await db.query.posts.findFirst();
    if (!firstPost || cats.length === 0) throw new Error("Seed data missing");
    await db
      .insert(postsToCategories)
      .values(cats.map((c) => ({ postId: firstPost.id, categoryId: c.id })))
      .onConflictDoNothing();

    const result = await client.query<{ findManyPost: PostResponse[] }>(FIND_MANY_POST, {
      where: { categoriesCount: { gte: 1 } },
    });

    expect(result.error).toBeUndefined();
    const data = result.data?.findManyPost;
    expect(data).toBeDefined();
    expect(data!.map((p) => p.id)).toContain(firstPost.id);
  });

  it("should sort posts by categoriesCount Desc (many-to-many)", async () => {
    const cats = await db.query.categories.findMany();
    const somePosts = await db.query.posts.findMany({ limit: 2 });
    if (cats.length === 0 || somePosts.length < 2) throw new Error("Seed data missing");
    // Give the first post two categories, the second post zero.
    await db
      .insert(postsToCategories)
      .values(cats.slice(0, 2).map((c) => ({ postId: somePosts[0]!.id, categoryId: c.id })))
      .onConflictDoNothing();

    const result = await client.query<{
      findManyPost: (PostResponse & { categoriesCount: number })[];
    }>(
      gql`
        query ($orderBy: [PostOrderBy!], $limit: Int) {
          findManyPost(orderBy: $orderBy, limit: $limit) {
            id
            categoriesCount
          }
        }
      `,
      { orderBy: [{ categoriesCount: "Desc" }], limit: 3 }
    );

    expect(result.error).toBeUndefined();
    const data = result.data!.findManyPost;
    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1]!.categoriesCount).toBeGreaterThanOrEqual(data[i]!.categoriesCount);
    }
  });
});

describe("findMany - relation count where/orderBy (User/Post)", () => {
  beforeAll(async () => {
    await db.resetSchema();
  });
  afterAll(async () => {
    await db.dropSchema();
  });

  it("should filter users by postsCount (one-to-many)", async () => {
    const FIND_MANY_USER = gql`
      query ($where: UserWhere) {
        findManyUser(where: $where) {
          id
          postsCount
        }
      }
    `;
    const result = await client.query<{
      findManyUser: { id: string; postsCount: number }[];
    }>(FIND_MANY_USER, { where: { postsCount: { gt: 0 } } });

    expect(result.error).toBeUndefined();
    const data = result.data!.findManyUser;
    expect(data.length).toBeGreaterThan(0);
    data.forEach((u) => expect(u.postsCount).toBeGreaterThan(0));
  });

  it("should sort users by postsCount Desc (one-to-many)", async () => {
    const FIND_MANY_USER = gql`
      query ($orderBy: [UserOrderBy!]) {
        findManyUser(orderBy: $orderBy) {
          id
          postsCount
        }
      }
    `;
    const result = await client.query<{
      findManyUser: { id: string; postsCount: number }[];
    }>(FIND_MANY_USER, { orderBy: [{ postsCount: "Desc" }] });

    expect(result.error).toBeUndefined();
    const data = result.data!.findManyUser;
    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1]!.postsCount).toBeGreaterThanOrEqual(data[i]!.postsCount);
    }
  });

  it("should filter users with no posts (postsCount eq 0)", async () => {
    const FIND_MANY_USER = gql`
      query ($where: UserWhere) {
        findManyUser(where: $where) {
          id
          postsCount
        }
      }
    `;
    const result = await client.query<{
      findManyUser: { id: string; postsCount: number }[];
    }>(FIND_MANY_USER, { where: { postsCount: { eq: 0 } } });

    expect(result.error).toBeUndefined();
    result.data!.findManyUser.forEach((u) => expect(u.postsCount).toBe(0));
  });

  it("should combine count filter with column filter", async () => {
    const FIND_MANY_USER = gql`
      query ($where: UserWhere) {
        findManyUser(where: $where) {
          id
          name
          postsCount
        }
      }
    `;
    const result = await client.query<{
      findManyUser: { id: string; name: string; postsCount: number }[];
    }>(FIND_MANY_USER, {
      where: {
        AND: [{ postsCount: { gte: 0 } }, { name: { isNotNull: true } }],
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.data!.findManyUser.length).toBeGreaterThan(0);
  });
});
describe("findMany - customize", async () => {
  beforeAll(async () => {
    await db.resetSchema();
  });
  afterAll(async () => {
    await db.dropSchema();
  });
  it("input throw", async () => {
    const { client } = createClient({
      searchPath: getSearchPath(import.meta.url),
      relations,
      pothosDrizzleGenerator: {
        all: {
          inputData: () => {
            throw new Error("No permission");
          },
          limit: () => 2,
        },
      },
    });
    const categories = await db.query.categories.findMany();
    const posts = await db.query.posts.findMany();
    await db
      .insert(postsToCategories)
      .values(posts.flatMap((p) => categories.map((c) => ({ postId: p.id, categoryId: c.id }))))
      .onConflictDoNothing();
    await client.query(FIND_MANY_POST, { limit: 4 }).then((result) => {
      expect(result.data.findManyPost).toHaveLength(2);
      expect(result.data.findManyPost[0].categories).toHaveLength(2);
    });
    await client.query(FIND_MANY_POST, { limit: 1, categoriesLimit: 1 }).then((result) => {
      expect(result.data.findManyPost).toHaveLength(1);
      expect(result.data.findManyPost[0].categories).toHaveLength(1);
    });
  });
});
