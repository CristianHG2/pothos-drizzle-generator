import { eq } from "drizzle-orm";
import { gql } from "@urql/core";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { relations } from "../db/relations";
import { posts } from "../db/schema";
import { createClient, getSearchPath } from "../libs/test-tools";

export const { app, client, db } = createClient({
  searchPath: getSearchPath(import.meta.url),
  relations,
  pothosDrizzleGenerator: {},
});


const FIND_FIRST_POST = gql`
  fragment post on Post {
    id
    title
    content
    published
    authorId
  }

  query FindFirstPost($where: PostWhere, $orderBy: [PostOrderBy!]) {
    findFirstPost(where: $where, orderBy: $orderBy) {
      ...post
      author {
        id
        name
      }
      categories {
        id
        name
      }
    }
  }
`;

const FIND_FIRST_POST2 = gql`
  query FindFirstPost($where: PostWhere, $orderBy: [PostOrderBy!]) {
    findFirstPost(where: $where, orderBy: $orderBy) {
      author {
        id
        name
      }
      categories {
        id
        name
      }
    }
  }
`;

const FIND_FIRST_POST3 = gql`
  query FindFirstPost($where: PostWhere, $orderBy: [PostOrderBy!]) {
    findFirstPost(where: $where, orderBy: $orderBy) {
      __typename
    }
  }
`;

const FIND_FIRST_POST4 = gql`
  fragment category on Category {
    id
    name
    createdAt
    updatedAt
  }

  fragment post on Post {
    id
    published
    title
    content
    authorId
    createdAt
    updatedAt
    publishedAt
  }
  fragment user on User {
    id
    email
    name
    roles
    createdAt
    updatedAt
  }
  query FindFirstPost(
    $offset: Int
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
    findFirstPost(offset: $offset, where: $where, orderBy: $orderBy) {
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

const FIND_FIRST_POST5 = gql`
  query FindFirstPost($where: PostWhere, $orderBy: [PostOrderBy!]) {
    findFirstPost(where: $where, orderBy: $orderBy) {
      __typename
      categories {
        __typename
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

describe("Query: findFirstPost (Drizzle v2 Pure Object Syntax)", () => {
  beforeAll(async () => {
    await db.resetSchema();
  });
  afterAll(async () => {
    await db.dropSchema();
  });
  it("should retrieve a first post using object-based where clause", async () => {
    
    const targetPost = await db.query.posts.findFirst({
      where: {
        id: { isNotNull: true },
      },
    });

    if (!targetPost) throw new Error("No posts found in database");

    const result = await client.query<{ findFirstPost: PostResponse }>(FIND_FIRST_POST, {
      where: {
        id: { eq: targetPost.id },
      },
    });

    expect(result.error).toBeUndefined();
    const data = result.data?.findFirstPost;

    if (!data) throw new Error("Query result data is missing");

    expect(data.id).toBe(targetPost.id);
    expect(data.title).toBe(targetPost.title);
    expect(data.author).toBeDefined();
    expect(Array.isArray(data.categories)).toBe(true);
  });

  it("should return the first record matching a specific non-id condition", async () => {
    
    const targetPost = await db.query.posts.findFirst({
      where: {
        published: { eq: true },
      },
    });

    if (!targetPost) throw new Error("No published posts found");

    const result = await client.query<{ findFirstPost: PostResponse }>(FIND_FIRST_POST, {
      where: {
        published: { eq: true },
      },
      orderBy: [{ createdAt: "Desc" }],
    });

    expect(result.data?.findFirstPost.published).toBe(true);
  });

  

  it("should handle complex object filtering with multiple fields", async () => {
    const targetPost = await db.query.posts.findFirst();
    if (!targetPost) throw new Error("Data required");

    const result = await client.query<{ findFirstPost: PostResponse }>(FIND_FIRST_POST, {
      where: {
        id: { eq: targetPost.id },
        title: { eq: targetPost.title },
        published: { eq: targetPost.published },
      },
    });

    expect(result.data?.findFirstPost.id).toBe(targetPost.id);
  });

  it("empty fields", async () => {
    const result = await client.query<{ findFirstPost: PostResponse }>(FIND_FIRST_POST2, {});
    expect(result.data?.findFirstPost).toBeDefined();
    const result2 = await client.query<{ findFirstPost: PostResponse }>(FIND_FIRST_POST3, {});
    expect(result2.data?.findFirstPost).toBeDefined();
    const result3 = await client.query<{ findFirstPost: PostResponse }>(FIND_FIRST_POST5, {});
    expect(result3.data?.findFirstPost.categories).toBeDefined();
  });

  it("should return null when no record matches the pure object criteria", async () => {
    const nonExistentId = "00000000-0000-0000-0000-000000000000";

    const result = await client.query<{ findFirstPost: PostResponse | null }>(FIND_FIRST_POST, {
      where: {
        id: { eq: nonExistentId },
      },
    });

    
    expect(result.data?.findFirstPost).toBeNull();
  });

  it("should retrieve a post with relation filtering in the where object", async () => {
    const author = await db.query.users.findFirst();
    if (!author) throw new Error("Author required");

    const result = await client.query<{ findFirstPost: PostResponse }>(FIND_FIRST_POST, {
      where: {
        authorId: { eq: author.id },
      },
    });

    expect(result.data?.findFirstPost.authorId).toBe(author.id);
    expect(result.data?.findFirstPost.author.id).toBe(author.id);
  });

  it("should filter by jsonb contains operator", async () => {
    const post = await db.query.posts.findFirst();
    if (!post) throw new Error("Post required");

    await db
      .update(posts)
      .set({ metadata: { status: "featured", tags: ["tech"] } })
      .where(eq(posts.id, post.id));

    const result = await client.query<{ findFirstPost: PostResponse }>(FIND_FIRST_POST, {
      where: {
        metadata: { contains: { status: "featured" } },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.findFirstPost).toBeDefined();
    expect(result.data?.findFirstPost.id).toBe(post.id);
  });

  it("should filter by jsonb hasKey operator", async () => {
    const post = await db.query.posts.findFirst();
    if (!post) throw new Error("Post required");

    await db
      .update(posts)
      .set({ metadata: { priority: "high" } })
      .where(eq(posts.id, post.id));

    const result = await client.query<{ findFirstPost: PostResponse }>(FIND_FIRST_POST, {
      where: {
        metadata: { hasKey: "priority" },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.findFirstPost).toBeDefined();
  });

  it("should filter by jsonb containedBy operator", async () => {
    const post = await db.query.posts.findFirst();
    if (!post) throw new Error("Post required");

    await db
      .update(posts)
      .set({ metadata: { color: "red" } })
      .where(eq(posts.id, post.id));

    const result = await client.query<{ findFirstPost: PostResponse }>(FIND_FIRST_POST, {
      where: {
        metadata: { containedBy: { color: "red", size: "large", weight: 10 } },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.findFirstPost).toBeDefined();
    expect(result.data?.findFirstPost.id).toBe(post.id);
  });

  it("should filter by jsonb hasAnyKeys operator", async () => {
    const post = await db.query.posts.findFirst();
    if (!post) throw new Error("Post required");

    await db
      .update(posts)
      .set({ metadata: { alpha: 1 } })
      .where(eq(posts.id, post.id));

    const result = await client.query<{ findFirstPost: PostResponse }>(FIND_FIRST_POST, {
      where: {
        metadata: { hasAnyKeys: ["alpha", "beta"] },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.findFirstPost).toBeDefined();
    expect(result.data?.findFirstPost.id).toBe(post.id);
  });

  it("should filter by jsonb hasAllKeys operator", async () => {
    const post = await db.query.posts.findFirst();
    if (!post) throw new Error("Post required");

    await db
      .update(posts)
      .set({ metadata: { keyA: 1, keyB: 2 } })
      .where(eq(posts.id, post.id));

    const result = await client.query<{ findFirstPost: PostResponse }>(FIND_FIRST_POST, {
      where: {
        metadata: { hasAllKeys: ["keyA", "keyB"] },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.findFirstPost).toBeDefined();
    expect(result.data?.findFirstPost.id).toBe(post.id);
  });

  it("should verify all parameters using FIND_FIRST_POST4", async () => {
    
    const post = await db.query.posts.findFirst({
      with: {
        author: true,
        categories: true,
      },
    });
    if (!post) throw new Error("Post required");

    const result = await client.query(FIND_FIRST_POST4, {
      offset: 0,
      where: {
        id: { eq: post.id },
      },
      orderBy: [{ createdAt: "Desc" }],
      authorCountWhere: {
        id: { isNotNull: true },
      },
      categoriesCountWhere: {
        id: { isNotNull: true },
      },
      authorOffset: 0,
      authorLimit: 1,
      authorWhere: {
        id: { eq: post.authorId },
      },
      authorOrderBy: [{ name: "Asc" }],
      categoriesOffset: 0,
      categoriesLimit: 10,
      categoriesWhere: {
        id: { isNotNull: true },
      },
      categoriesOrderBy: [{ name: "Asc" }],
    });

    expect(result.error).toBeUndefined();
    const data = result.data?.findFirstPost;
    expect(data).toBeDefined();
    expect(data.id).toBe(post.id);
    expect(data.author).toBeDefined();
    expect(data.author.id).toBe(post.authorId);
    expect(data.authorCount).toBeGreaterThanOrEqual(0);
    expect(data.categoriesCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(data.categories)).toBe(true);
  });
});
