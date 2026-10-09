CREATE TYPE "Role" AS ENUM('ADMIN', 'USER');--> statement-breakpoint
CREATE TABLE "Category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Post" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"published" boolean DEFAULT false NOT NULL,
	"title" text DEFAULT 'New Post' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"metadata" jsonb,
	"authorId" uuid,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"publishedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PostToCategory" (
	"postId" uuid,
	"categoryId" uuid,
	CONSTRAINT "PostToCategory_pkey" PRIMARY KEY("postId","categoryId")
);
--> statement-breakpoint
CREATE TABLE "Test" (
	"integer" integer,
	"integerArray" integer[],
	"real" real,
	"realArray" real[],
	"smallint" smallint,
	"enum" "Role",
	"bigint" bigint,
	"bigintNumber" bigint,
	"bigintString" bigint,
	"bigintArray" bigint[],
	"serial" serial,
	"smallserial" smallserial,
	"bigserial" bigserial,
	"bigserialNumber" bigserial,
	"boolean" boolean,
	"booleanArray" boolean[],
	"bytea" bytea,
	"byteaArray" bytea[],
	"text" text,
	"textArray" text[],
	"varchar" varchar,
	"char" char(16),
	"numeric" numeric,
	"numericNumber" numeric,
	"numericString" numeric,
	"decimal" numeric,
	"decimalNumber" numeric,
	"decimalString" numeric,
	"doublePrecision" double precision,
	"json" json,
	"jsonb" jsonb,
	"jsonbArray" jsonb[],
	"uuid" uuid,
	"time" time,
	"timestamp" timestamp,
	"timestampArray" timestamp[],
	"date" date,
	"interval" interval,
	"point" point,
	"pointTuple" point,
	"line" line,
	"lineTuple" line
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL UNIQUE,
	"name" text DEFAULT 'User' NOT NULL,
	"roles" "Role"[] DEFAULT '{USER}'::"Role"[] NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_User_id_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "PostToCategory" ADD CONSTRAINT "PostToCategory_postId_Post_id_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "PostToCategory" ADD CONSTRAINT "PostToCategory_categoryId_Category_id_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE;