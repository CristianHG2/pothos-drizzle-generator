import {
  pgTable,
  pgEnum,
  primaryKey,
  uuid,
  text,
  boolean,
  timestamp,
  bigint,
} from "drizzle-orm/pg-core";

import * as p from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("Role", ["ADMIN", "USER"]);

export const users = pgTable("User", {
  id: uuid().defaultRandom().primaryKey(),
  email: text().notNull().unique(),
  name: text().notNull().default("User"),
  roles: roleEnum().array().default(["USER"]).notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const posts = pgTable("Post", {
  id: uuid().defaultRandom().primaryKey(),
  published: boolean().notNull().default(false),
  title: text().notNull().default("New Post"),
  content: text().notNull().default(""),
  metadata: p.jsonb(),
  authorId: uuid().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const categories = pgTable("Category", {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const postsToCategories = pgTable(
  "PostToCategory",
  {
    postId: uuid()
      .notNull()
      .primaryKey()
      .references(() => posts.id, { onDelete: "cascade" }),
    categoryId: uuid()
      .notNull()
      .primaryKey()
      .references(() => categories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.categoryId] })]
);

export const test = pgTable("Test", {
  integer: p.integer(),
  integerArray: p.integer().array(),
  real: p.real(),
  realArray: p.real().array(),
  smallint: p.smallint(),
  enum: roleEnum(),
  bigint: bigint({ mode: "bigint" }),
  bigintNumber: bigint({ mode: "number" }),
  bigintString: bigint({ mode: "string" }),
  bigintArray: bigint({ mode: "bigint" }).array(),
  serial: p.serial(),
  smallserial: p.smallserial(),
  bigserial: p.bigserial({ mode: "bigint" }),
  bigserialNumber: p.bigserial({ mode: "number" }),
  boolean: p.boolean(),
  booleanArray: p.boolean().array(),
  bytea: p.bytea(),
  byteaArray: p.bytea().array(),
  text: p.text(),
  textArray: p.text().array(),
  varchar: p.varchar(),
  char: p.char({ length: 16 }),
  numeric: p.numeric({ mode: "bigint" }),
  numericNumber: p.numeric({ mode: "number" }),
  numericString: p.numeric({ mode: "string" }),
  decimal: p.decimal({ mode: "bigint" }),
  decimalNumber: p.decimal({ mode: "number" }),
  decimalString: p.decimal({ mode: "string" }),
  doublePrecision: p.doublePrecision(),
  json: p.json(),
  jsonb: p.jsonb(),
  jsonbArray: p.jsonb().array(),
  uuid: p.uuid(),
  time: p.time(),
  timestamp: p.timestamp(),
  timestampArray: p.timestamp().array(),
  date: p.date(),
  interval: p.interval(),
  point: p.point({ mode: "xy" }),
  pointTuple: p.point({ mode: "tuple" }),
  line: p.line({ mode: "abc" }),
  lineTuple: p.line({ mode: "tuple" }),
});
