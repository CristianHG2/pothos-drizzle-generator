# ⚙️ Configuration Guide

[🔙 Back to Main README](../README.md)

The `pothosDrizzleGenerator` option offers a layered configuration approach, giving you full control over the generated schema.

Rules are applied in the following order:

1. **Selection (`use`)**: Define which tables to process.
2. **Global Defaults (`all`)**: Apply baseline rules to _every_ model.
3. **Model Overrides (`models`)**: Apply specific rules to individual models, overriding defaults.

## 1. Table Selection (`use`)

Control which tables are exposed in the GraphQL schema. This is useful for hiding internal tables or many-to-many join tables.

```ts
pothosDrizzleGenerator: {
  // Option A: Allowlist (Only generate these tables)
  use: { include: ["users", "posts", "comments"] },

  // Option B: Blocklist (Generate all EXCEPT these)
  use: { exclude: ["users_to_groups", "audit_logs"] },
}

```

## 2. Global Defaults (`all`)

Use the `all` key to establish project-wide conventions, such as security policies, default query limits, or field visibility.

```ts
pothosDrizzleGenerator: {
  all: {
    // Security: Require authentication for all write operations
    executable: ({ ctx, operation }) => {
       if (['create', 'update', 'delete'].includes(operation)) {
         return !!ctx.userId; // Must be logged in
       }
       return true; // Read operations are public
    },
    // Performance: Set a default limit for all queries
    limit: () => 50,
  }
}

```

## 3. Model Overrides (`models`)

Target specific tables by name to override global settings.

```ts
pothosDrizzleGenerator: {
  models: {
    users: {
      // Privacy: Users can only query their own record
      where: ({ ctx }) => ({ id: { eq: ctx.userId } }),
      // Security: Prevent user deletion via API
      operations: () => ({ exclude: ["delete"] })
    }
  }
}

```

## 4. API Reference

The following callbacks can be used within both `all` and `models`.

| Property      | Purpose                                                    | Arguments                       | Expected Return                                        |
| ------------- | ---------------------------------------------------------- | ------------------------------- | ------------------------------------------------------ |
| `executable`  | Authorization check. Return `false` to block execution.    | `{ ctx, modelName, operation }` | `boolean`                                              |
| `fields`      | Control output field visibility. Excluded columns and relations are also left out of `Where` and `OrderBy`, so they cannot be filtered or sorted on. | `{ modelName }`                 | `{ include?: [], exclude?: [] }`                       |
| `inputFields` | Control input field visibility (for mutations).            | `{ modelName }`                 | `{ include?: [], exclude?: [] }`                       |
| `operations`  | Select which CRUD operations to generate.                  | `{ modelName }`                 | `{ include?: [], exclude?: [] }`                       |
| `aliases`     | Customize GraphQL type and operation names.                | `{ modelName }`                 | `{ singular?: string, plural?: string, operations?: {} }` |
| `where`       | Apply mandatory filters (e.g., multi-tenancy).             | `{ ctx, modelName, operation }` | `FilterObject`                                         |
| `limit`       | Set default max records for `findMany`.                    | `{ ctx, modelName, operation }` | `number`                                               |
| `depthLimit`  | Prevent deeply nested queries.                             | `{ ctx, modelName, operation }` | `number`                                               |
| `orderBy`     | Set default sort order.                                    | `{ ctx, modelName, operation }` | `{ [col]: 'asc' \| 'desc' }`                           |
| `inputData`   | Inject server-side values (e.g., `userId`) into mutations. | `{ ctx, modelName, operation }` | `Object`                                               |

## 5. Aliases - Customize Type & Operation Names

The `aliases` configuration allows you to customize both GraphQL type names and operation names, giving you full control over your API's naming conventions.

### Type Name Aliases

Use `singular` to rename the GraphQL type generated for a model:

```ts
pothosDrizzleGenerator: {
  models: {
    posts: {
      aliases: () => ({
        singular: "Article",  // Renames "Post" → "Article"
      })
    }
  }
}
```

This changes:
- GraphQL type: `Post` → `Article`
- Input types: `PostCreate` → `ArticleCreate`, `PostWhere` → `ArticleWhere`, etc.

### Operation Name Aliases

Use `operations` to rename individual CRUD operations:

```ts
pothosDrizzleGenerator: {
  models: {
    posts: {
      aliases: () => ({
        operations: {
          findMany: "listArticles",
          findFirst: "getArticle",
          count: "countArticles",
          createOne: "createArticle",
          createMany: "createArticles",
          update: "updateArticles",
          delete: "deleteArticles",
        }
      })
    }
  }
}
```

**Default Behavior:**
- If an operation alias is provided, it's used directly as the operation name
- If no operation alias is provided, the default pattern is used: `{operation}{SingularTypeName}`
  - Examples: `findManyPost`, `createOneUser`, `updateCategory`

### Combining Type & Operation Aliases

You can use both together for complete customization:

```ts
pothosDrizzleGenerator: {
  models: {
    posts: {
      aliases: () => ({
        singular: "BlogPost",
        operations: {
          findMany: "listBlogPosts",
          createOne: "publishBlogPost",
        }
      })
    }
  }
}
```

This creates:
- Type: `BlogPost` (with `BlogPostCreate`, `BlogPostWhere`, etc.)
- Operations: `listBlogPosts`, `publishBlogPost`, `findFirstBlogPost`, `countBlogPost`, etc.

## 6. Helper Functions

Import `isOperation` to simplify conditional logic within your callbacks.

```ts
import { isOperation } from "pothos-drizzle-generator";

// Usage Example
executable: ({ ctx, operation }) => {
  // Check if operation is a mutation (create/update/delete)
  if (isOperation("mutation", operation)) {
    return !!ctx.user;
  }
  return true;
},

```

**Available Operation Categories:**

- `OperationFind`: `findFirst`, `findMany`
- `OperationQuery`: `findFirst`, `findMany`, `count`
- `OperationCreate`: `createOne`, `createMany`
- `OperationUpdate`: `update`
- `OperationDelete`: `delete`
- `OperationMutation`: All write operations.
- `OperationAll`: Everything.

---

## 7. Comprehensive Configuration Example

This example demonstrates a production-ready setup combining global security rules with specific model overrides, showcasing advanced usage of various configuration options.

```ts
import { isOperation } from "pothos-drizzle-generator";
import type { PothosTypes } from "./types"; // Assuming you have a types file for Pothos

const builder = new SchemaBuilder<PothosTypes>({
  // ... Pothos plugins setup, e.g., plugins: [SimpleObjectsPlugin, DrizzlePlugin],
  pothosDrizzleGenerator: {
    // 1. Table Selection:
    // Exclude specific tables from the GraphQL schema.
    // This is useful for internal tables or many-to-many join tables that
    // you don't want directly exposed or managed via GraphQL.
    use: { exclude: ["userToTeams", "transactionLogs"] },

    // 2. Global Defaults:
    // These rules apply to ALL models unless explicitly overridden by a model-specific configuration.
    all: {
      // Security - Authorization:
      // - Allow all read operations (queries) for everyone.
      // - Require authentication for any write operations (mutations).
      //   'ctx.user' is assumed to be available from your Pothos context.
      executable: ({ ctx, operation }) => {
        if (isOperation("mutation", operation)) {
          return !!ctx.user; // Only authenticated users can perform mutations
        }
        return true; // All read operations are public
      },

      // Privacy - Field Visibility (Output):
      // - Globally exclude sensitive fields like passwords, API keys, or internal timestamps
      //   from being returned in any query.
      fields: () => ({ exclude: ["passwordHash", "apiKey", "internalNotes", "deletedAt"] }),

      // Integrity - Field Visibility (Input):
      // - Prevent users from manually setting system-managed fields during mutations.
      //   'id', 'createdAt', 'updatedAt' are typically managed by the database or server.
      inputFields: () => ({ exclude: ["id", "createdAt", "updatedAt"] }),

      // Data Integrity - Mandatory Filtering:
      // - Implement soft-delete: By default, only retrieve records where 'deletedAt' is null.
      // - EXCEPTION: When performing a 'delete' operation, we explicitly want to find the
      //   record regardless of its soft-delete status to mark it as deleted.
      where: ({ operation }) => {
        if (operation !== "delete") {
          return { deletedAt: { isNull: true } }; // Only show non-deleted records
        }
        return {}; // Allow finding deleted records for the delete operation itself
      },

      // Performance - Default Limits:
      // - Set a default maximum number of records for all 'findMany' queries to prevent
      //   accidental large data fetches. Clients can usually override this, but a safe
      //   default is crucial.
      limit: () => 50,

      // Performance - Query Depth Limit:
      // - Restrict the maximum depth of nested relations that can be queried to prevent
      //   complex, resource-intensive queries that could impact server performance.
      depthLimit: () => 5,

      // Data Ordering - Default Sort:
      // - Establish a consistent default sort order for all lists.
      orderBy: () => ({ createdAt: "desc" }),
    },

    // 3. Model Overrides:
    // Specific rules for individual models that override the global defaults defined above.
    models: {
      users: {
        // Privacy & Security - User-specific Data Access:
        // - A user can only retrieve, update, or delete their OWN record.
        //   This 'where' clause ensures that all operations on the 'users' model
        //   are scoped to the current authenticated user's ID.
        where: ({ ctx, operation }) => {
          if (!ctx.user) return { id: { eq: "unauthenticated" } }; // Unauthenticated users can't see any user data
          // For 'findFirst', 'update', 'delete' operations, restrict to current user's ID
          if (["findFirst", "update", "delete"].includes(operation)) {
            return { id: { eq: ctx.user.id } };
          }
          // For 'findMany' (e.g., listing users, if allowed), still only show self
          // or apply other broader filters if needed. For this example, keep it strict.
          return { id: { eq: ctx.user.id } };
        },
        // Limit: Enforce that only one user record can be fetched at a time via `findFirst` or specific `findMany` queries.
        limit: () => 1,
        operations: () => ({ exclude: ["delete"] }),
        // Naming: Use domain-specific terminology
        aliases: () => ({
          singular: "Member",
          operations: {
            findMany: "listMembers",
            findFirst: "getMember",
          }
        }),
      },

      posts: {
        // Data Integrity - Override Global Limit:
        // - Allow up to 100 posts to be fetched at once, overriding the global default of 50.
        limit: () => 100,

        // Automation - Inject Server-side Data:
        // - When creating or updating a post, automatically set the 'authorId' to the
        //   current authenticated user's ID. This prevents clients from spoofing authors.
        inputData: ({ ctx }) => ({ authorId: ctx.user?.id }),

        // Authorization & Logic - Conditional Access for Posts:
        // - Read operations (`findMany`, `findFirst`): Allow public posts OR posts authored by the current user.
        // - Write operations (`create`, `update`, `delete`): Only allow the author of the post to perform these actions.
        where: ({ ctx, operation }) => {
          if (isOperation("query", operation)) {
            // Guests can see published posts, authenticated users can see published + their own
            return {
              OR: [{ published: { eq: true } }, { authorId: { eq: ctx.user?.id } }],
            };
          }
          if (isOperation(["update", "delete"], operation)) {
            // Only the author can update or delete their posts
            return { authorId: { eq: ctx.user?.id } };
          }
          // For create operations, no specific WHERE clause needed, inputData handles authorId
          return {};
        },
      },

      comments: {
        // Authorization - Restrict creation and updates:
        // - Only authenticated users can create or update comments. This is already covered
        //   by the global `executable` rule, but explicitly showcasing here for clarity
        //   or if `comments` had different global `executable` rules.
        executable: ({ ctx, operation }) => {
          if (isOperation(["create", "update"], operation)) {
            return !!ctx.user;
          }
          return true; // Read and delete operations are allowed for all (with other rules applying)
        },
        // Data Integrity - Default ordering for comments
        orderBy: () => ({ createdAt: "asc" }),
        // Input Fields: Prevent direct manipulation of `postId` after creation
        inputFields: ({ operation }) => {
          if (operation === "update") {
            return { exclude: ["postId"] };
          }
          return {};
        },
        // Authorization: Only allow authenticated users to delete their own comments
        where: ({ ctx, operation }) => {
          if (isOperation("delete", operation)) {
            return { authorId: { eq: ctx.user?.id } };
          }
          return {};
        },
        // Naming: Blog-specific operations
        aliases: () => ({
          singular: "Article",
          operations: {
            createOne: "publish",
            update: "revise",
            delete: "unpublish",
          }
        }),
      },

      auditLogs: {
        // Security - Admin-only Access:
        // - Completely restrict access to `auditLogs` model to users with `isAdmin` flag.
        executable: ({ ctx }) => !!ctx.user?.isAdmin,
        // Operations: Make audit logs read-only to prevent tampering.
        operations: () => ({ exclude: ["create", "update", "delete"] }),
        // Performance: Restrict the number of audit logs fetched at once.
        limit: () => 20,
      },
    },
  },
});
```
