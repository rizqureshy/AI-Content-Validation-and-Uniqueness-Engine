import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  integer,
  bigint,
  timestamp,
  boolean,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";
import { z } from "zod";

const EMBEDDING_DIM = 1536;

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return `vector(${EMBEDDING_DIM})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    if (Array.isArray(value)) return value as unknown as number[];
    return JSON.parse(value);
  },
});

export const sharepointSites = pgTable("sharepoint_sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  siteId: text("site_id").notNull().unique(),
  siteName: text("site_name").notNull(),
  siteUrl: text("site_url").notNull(),
  driveId: text("drive_id"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").references(() => sharepointSites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    path: text("path").notNull(),
    driveId: text("drive_id"),
    itemId: text("item_id").notNull(),
    mimeType: text("mime_type"),
    size: bigint("size", { mode: "number" }),
    content: text("content"),
    noveltyScore: doublePrecision("novelty_score"),
    healthScore: doublePrecision("health_score"),
    duplicateCount: integer("duplicate_count").default(0).notNull(),
    similarCount: integer("similar_count").default(0).notNull(),
    conflictCount: integer("conflict_count").default(0).notNull(),
    chunkCount: integer("chunk_count").default(0).notNull(),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    modifiedAt: timestamp("modified_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    itemIdx: uniqueIndex("documents_item_id_idx").on(t.itemId),
    siteIdx: index("documents_site_id_idx").on(t.siteId),
  }),
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    tokenCount: integer("token_count").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    headingPath: text("heading_path"),
    embedding: vector("embedding"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    docIdx: index("document_chunks_document_id_idx").on(t.documentId),
    docChunkIdx: uniqueIndex("document_chunks_doc_chunk_idx").on(
      t.documentId,
      t.chunkIndex,
    ),
    embeddingIdx: index("document_chunks_embedding_idx")
      .using("ivfflat", sql`embedding vector_cosine_ops`)
      .with({ lists: 100 }),
  }),
);

export const chunkSimilarities = pgTable(
  "chunk_similarities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chunkId1: uuid("chunk_id_1")
      .notNull()
      .references(() => documentChunks.id, { onDelete: "cascade" }),
    chunkId2: uuid("chunk_id_2")
      .notNull()
      .references(() => documentChunks.id, { onDelete: "cascade" }),
    documentId1: uuid("document_id_1")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    documentId2: uuid("document_id_2")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    similarityScore: doublePrecision("similarity_score").notNull(),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pairIdx: uniqueIndex("chunk_similarities_pair_idx").on(t.chunkId1, t.chunkId2),
    doc1Idx: index("chunk_similarities_doc1_idx").on(t.documentId1),
    doc2Idx: index("chunk_similarities_doc2_idx").on(t.documentId2),
    scoreIdx: index("chunk_similarities_score_idx").on(t.similarityScore),
  }),
);

export const conflictTypeEnum = z.enum(["numerical", "date", "factual", "entity"]);
export type ConflictType = z.infer<typeof conflictTypeEnum>;

export const severityEnum = z.enum(["critical", "warning", "info"]);
export type Severity = z.infer<typeof severityEnum>;

export const conflicts = pgTable(
  "conflicts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chunkId1: uuid("chunk_id_1").references(() => documentChunks.id, { onDelete: "cascade" }),
    chunkId2: uuid("chunk_id_2").references(() => documentChunks.id, { onDelete: "cascade" }),
    documentId1: uuid("document_id_1")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    documentId2: uuid("document_id_2")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    conflictType: text("conflict_type").notNull(),
    severity: text("severity").notNull(),
    description: text("description").notNull(),
    value1: text("value_1"),
    value2: text("value_2"),
    context1: text("context_1"),
    context2: text("context_2"),
    resolved: boolean("resolved").default(false).notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    doc1Idx: index("conflicts_doc1_idx").on(t.documentId1),
    doc2Idx: index("conflicts_doc2_idx").on(t.documentId2),
    resolvedIdx: index("conflicts_resolved_idx").on(t.resolved),
  }),
);

export const analysisJobs = pgTable("analysis_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: text("status").notNull().default("pending"),
  progress: integer("progress").default(0).notNull(),
  totalDocuments: integer("total_documents").default(0).notNull(),
  documentIds: jsonb("document_ids"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SharepointSite = typeof sharepointSites.$inferSelect;
export type NewSharepointSite = typeof sharepointSites.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type NewDocumentChunk = typeof documentChunks.$inferInsert;
export type ChunkSimilarity = typeof chunkSimilarities.$inferSelect;
export type Conflict = typeof conflicts.$inferSelect;
export type NewConflict = typeof conflicts.$inferInsert;
export type AnalysisJob = typeof analysisJobs.$inferSelect;

export interface SimilarChunk {
  chunk: DocumentChunk;
  document: Document;
  similarity: number;
}

export interface PrePublishCheckResult {
  novelty: number;
  conflicts: Array<{
    type: ConflictType;
    severity: Severity;
    description: string;
    value1?: string;
    value2?: string;
    context1?: string;
    context2?: string;
    matchedDocument: { id: string; name: string; path: string };
  }>;
  similarDocuments: Array<{
    document: Pick<Document, "id" | "name" | "path">;
    topSimilarity: number;
    matchedChunks: Array<{
      newChunkText: string;
      existingChunkText: string;
      similarity: number;
      explanation?: string;
    }>;
  }>;
  suggestedLocation: string;
  recommendation: "publish" | "review" | "reject";
  issues: string[];
}

export const SIM_THRESHOLDS = {
  duplicate: 0.8,
  similar: 0.5,
  store: 0.3,
  conflictTrigger: 0.6,
} as const;
