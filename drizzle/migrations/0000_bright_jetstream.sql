CREATE TABLE IF NOT EXISTS "analysis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"total_documents" integer DEFAULT 0 NOT NULL,
	"document_ids" jsonb,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chunk_similarities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chunk_id_1" uuid NOT NULL,
	"chunk_id_2" uuid NOT NULL,
	"document_id_1" uuid NOT NULL,
	"document_id_2" uuid NOT NULL,
	"similarity_score" double precision NOT NULL,
	"analyzed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chunk_id_1" uuid,
	"chunk_id_2" uuid,
	"document_id_1" uuid NOT NULL,
	"document_id_2" uuid NOT NULL,
	"conflict_type" text NOT NULL,
	"severity" text NOT NULL,
	"description" text NOT NULL,
	"value_1" text,
	"value_2" text,
	"context_1" text,
	"context_2" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"text" text NOT NULL,
	"token_count" integer NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"heading_path" text,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"name" text NOT NULL,
	"path" text NOT NULL,
	"drive_id" text,
	"item_id" text NOT NULL,
	"mime_type" text,
	"size" bigint,
	"content" text,
	"novelty_score" double precision,
	"health_score" double precision,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"similar_count" integer DEFAULT 0 NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"analyzed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"modified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sharepoint_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" text NOT NULL,
	"site_name" text NOT NULL,
	"site_url" text NOT NULL,
	"drive_id" text,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sharepoint_sites_site_id_unique" UNIQUE("site_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chunk_similarities" ADD CONSTRAINT "chunk_similarities_chunk_id_1_document_chunks_id_fk" FOREIGN KEY ("chunk_id_1") REFERENCES "public"."document_chunks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chunk_similarities" ADD CONSTRAINT "chunk_similarities_chunk_id_2_document_chunks_id_fk" FOREIGN KEY ("chunk_id_2") REFERENCES "public"."document_chunks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chunk_similarities" ADD CONSTRAINT "chunk_similarities_document_id_1_documents_id_fk" FOREIGN KEY ("document_id_1") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "chunk_similarities" ADD CONSTRAINT "chunk_similarities_document_id_2_documents_id_fk" FOREIGN KEY ("document_id_2") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_chunk_id_1_document_chunks_id_fk" FOREIGN KEY ("chunk_id_1") REFERENCES "public"."document_chunks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_chunk_id_2_document_chunks_id_fk" FOREIGN KEY ("chunk_id_2") REFERENCES "public"."document_chunks"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_document_id_1_documents_id_fk" FOREIGN KEY ("document_id_1") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_document_id_2_documents_id_fk" FOREIGN KEY ("document_id_2") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_site_id_sharepoint_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sharepoint_sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "chunk_similarities_pair_idx" ON "chunk_similarities" USING btree ("chunk_id_1","chunk_id_2");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunk_similarities_doc1_idx" ON "chunk_similarities" USING btree ("document_id_1");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunk_similarities_doc2_idx" ON "chunk_similarities" USING btree ("document_id_2");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunk_similarities_score_idx" ON "chunk_similarities" USING btree ("similarity_score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conflicts_doc1_idx" ON "conflicts" USING btree ("document_id_1");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conflicts_doc2_idx" ON "conflicts" USING btree ("document_id_2");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conflicts_resolved_idx" ON "conflicts" USING btree ("resolved");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_document_id_idx" ON "document_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_chunks_doc_chunk_idx" ON "document_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_chunks_embedding_idx" ON "document_chunks" USING ivfflat (embedding vector_cosine_ops) WITH (lists=100);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "documents_item_id_idx" ON "documents" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_site_id_idx" ON "documents" USING btree ("site_id");