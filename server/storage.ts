import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "./db.js";
import {
  analysisJobs,
  chunkSimilarities,
  conflicts,
  documentChunks,
  documents,
  sharepointSites,
  SIM_THRESHOLDS,
  type Document,
  type DocumentChunk,
  type NewConflict,
  type NewDocument,
  type NewDocumentChunk,
} from "../shared/schema.js";

export interface SimilarChunkRow {
  chunkId: string;
  documentId: string;
  documentName: string;
  documentPath: string;
  chunkIndex: number;
  text: string;
  headingPath: string | null;
  similarity: number;
}

function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export async function listSites() {
  return db.select().from(sharepointSites).orderBy(desc(sharepointSites.lastSyncAt));
}

export async function upsertSite(input: {
  siteId: string;
  siteName: string;
  siteUrl: string;
  driveId?: string;
}) {
  const existing = await db
    .select()
    .from(sharepointSites)
    .where(eq(sharepointSites.siteId, input.siteId));
  if (existing[0]) {
    const [updated] = await db
      .update(sharepointSites)
      .set({ ...input, lastSyncAt: new Date() })
      .where(eq(sharepointSites.id, existing[0].id))
      .returning();
    return updated!;
  }
  const [created] = await db
    .insert(sharepointSites)
    .values({ ...input, lastSyncAt: new Date() })
    .returning();
  return created!;
}

export async function getDocumentByItemId(itemId: string): Promise<Document | undefined> {
  const [row] = await db.select().from(documents).where(eq(documents.itemId, itemId));
  return row;
}

export async function createDocument(input: NewDocument): Promise<Document> {
  const [row] = await db.insert(documents).values(input).returning();
  return row!;
}

export async function updateDocument(id: string, patch: Partial<NewDocument>): Promise<Document> {
  const [row] = await db
    .update(documents)
    .set({ ...patch, modifiedAt: new Date() })
    .where(eq(documents.id, id))
    .returning();
  return row!;
}

export async function getDocument(id: string): Promise<Document | undefined> {
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  return row;
}

export async function listDocuments(limit = 100, offset = 0) {
  return db.select().from(documents).orderBy(desc(documents.modifiedAt)).limit(limit).offset(offset);
}

export async function recentDocuments(limit = 10) {
  return db.select().from(documents).orderBy(desc(documents.modifiedAt)).limit(limit);
}

export async function deleteChunksForDocument(documentId: string): Promise<void> {
  await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
}

export async function insertChunks(rows: NewDocumentChunk[]): Promise<DocumentChunk[]> {
  if (!rows.length) return [];
  const out: DocumentChunk[] = [];
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const inserted = await db.insert(documentChunks).values(batch).returning();
    out.push(...inserted);
  }
  return out;
}

export async function getChunksForDocument(documentId: string): Promise<DocumentChunk[]> {
  return db
    .select()
    .from(documentChunks)
    .where(eq(documentChunks.documentId, documentId))
    .orderBy(documentChunks.chunkIndex);
}

export async function findSimilarChunks(
  embedding: number[],
  threshold: number,
  excludeDocumentId?: string,
  limit = 50,
): Promise<SimilarChunkRow[]> {
  const lit = vectorLiteral(embedding);
  const exclude = excludeDocumentId
    ? sql`AND dc.document_id <> ${excludeDocumentId}::uuid`
    : sql``;
  const rows = await db.execute(sql`
    SELECT
      dc.id           AS chunk_id,
      dc.document_id  AS document_id,
      d.name          AS document_name,
      d.path          AS document_path,
      dc.chunk_index  AS chunk_index,
      dc.text         AS text,
      dc.heading_path AS heading_path,
      1 - (dc.embedding <=> ${lit}::vector) AS similarity
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE dc.embedding IS NOT NULL
      ${exclude}
    ORDER BY dc.embedding <=> ${lit}::vector ASC
    LIMIT ${limit}
  `);

  const out: SimilarChunkRow[] = [];
  for (const r of rows.rows as Array<Record<string, unknown>>) {
    const sim = Number(r.similarity);
    if (sim < threshold) continue;
    out.push({
      chunkId: String(r.chunk_id),
      documentId: String(r.document_id),
      documentName: String(r.document_name),
      documentPath: String(r.document_path),
      chunkIndex: Number(r.chunk_index),
      text: String(r.text),
      headingPath: r.heading_path == null ? null : String(r.heading_path),
      similarity: sim,
    });
  }
  return out;
}

export async function recordChunkSimilarity(
  chunkId1: string,
  chunkId2: string,
  documentId1: string,
  documentId2: string,
  score: number,
): Promise<void> {
  const [a, b] =
    chunkId1 < chunkId2
      ? [
          { chunkId: chunkId1, docId: documentId1 },
          { chunkId: chunkId2, docId: documentId2 },
        ]
      : [
          { chunkId: chunkId2, docId: documentId2 },
          { chunkId: chunkId1, docId: documentId1 },
        ];
  await db
    .insert(chunkSimilarities)
    .values({
      chunkId1: a.chunkId,
      chunkId2: b.chunkId,
      documentId1: a.docId,
      documentId2: b.docId,
      similarityScore: score,
    })
    .onConflictDoNothing();
}

export async function listSimilarities(limit = 100) {
  return db
    .select()
    .from(chunkSimilarities)
    .orderBy(desc(chunkSimilarities.similarityScore))
    .limit(limit);
}

export async function createConflict(input: NewConflict) {
  const [row] = await db.insert(conflicts).values(input).returning();
  return row!;
}

export async function listConflicts(opts?: { resolved?: boolean; limit?: number }) {
  const limit = opts?.limit ?? 100;
  if (opts?.resolved !== undefined) {
    return db
      .select()
      .from(conflicts)
      .where(eq(conflicts.resolved, opts.resolved))
      .orderBy(desc(conflicts.detectedAt))
      .limit(limit);
  }
  return db.select().from(conflicts).orderBy(desc(conflicts.detectedAt)).limit(limit);
}

export async function recentConflicts(limit = 10) {
  return db
    .select()
    .from(conflicts)
    .where(eq(conflicts.resolved, false))
    .orderBy(desc(conflicts.detectedAt))
    .limit(limit);
}

export async function resolveConflict(id: string) {
  const [row] = await db
    .update(conflicts)
    .set({ resolved: true })
    .where(eq(conflicts.id, id))
    .returning();
  return row;
}

export async function recomputeDocumentAggregates(documentId: string): Promise<void> {
  await db.execute(sql`
    UPDATE documents d SET
      duplicate_count = (
        SELECT COUNT(DISTINCT CASE WHEN cs.document_id_1 = d.id THEN cs.document_id_2 ELSE cs.document_id_1 END)
        FROM chunk_similarities cs
        WHERE (cs.document_id_1 = d.id OR cs.document_id_2 = d.id)
          AND cs.similarity_score >= ${SIM_THRESHOLDS.duplicate}
      ),
      similar_count = (
        SELECT COUNT(DISTINCT CASE WHEN cs.document_id_1 = d.id THEN cs.document_id_2 ELSE cs.document_id_1 END)
        FROM chunk_similarities cs
        WHERE (cs.document_id_1 = d.id OR cs.document_id_2 = d.id)
          AND cs.similarity_score >= ${SIM_THRESHOLDS.similar}
          AND cs.similarity_score <  ${SIM_THRESHOLDS.duplicate}
      ),
      conflict_count = (
        SELECT COUNT(*)
        FROM conflicts c
        WHERE (c.document_id_1 = d.id OR c.document_id_2 = d.id)
          AND c.resolved = false
      )
    WHERE d.id = ${documentId}::uuid
  `);
}

export async function categoryDocuments(opts: {
  category: "duplicates" | "similar" | "novel" | "conflicts";
  limit: number;
  offset: number;
}) {
  const { category, limit, offset } = opts;
  let where;
  switch (category) {
    case "duplicates":
      where = gte(documents.duplicateCount, 1);
      break;
    case "similar":
      where = and(gte(documents.similarCount, 1), eq(documents.duplicateCount, 0));
      break;
    case "novel":
      where = lt(documents.noveltyScore, 0.3);
      break;
    case "conflicts":
      where = gte(documents.conflictCount, 1);
      break;
  }
  const data = await db
    .select()
    .from(documents)
    .where(where)
    .orderBy(desc(documents.modifiedAt))
    .limit(limit)
    .offset(offset);
  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documents)
    .where(where);
  return { data, total: totalRows[0]?.count ?? 0 };
}

export async function repositoryHealth() {
  const [docs] = await db.select({ c: sql<number>`count(*)::int` }).from(documents);
  const [dups] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(chunkSimilarities)
    .where(gte(chunkSimilarities.similarityScore, SIM_THRESHOLDS.duplicate));
  const [sims] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(chunkSimilarities)
    .where(
      and(
        gte(chunkSimilarities.similarityScore, SIM_THRESHOLDS.similar),
        lt(chunkSimilarities.similarityScore, SIM_THRESHOLDS.duplicate),
      ),
    );
  const [openConflicts] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(conflicts)
    .where(eq(conflicts.resolved, false));
  const [novel] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(documents)
    .where(lt(documents.noveltyScore, 0.3));
  return {
    totalDocuments: docs?.c ?? 0,
    duplicatePairs: dups?.c ?? 0,
    similarPairs: sims?.c ?? 0,
    novelDocuments: novel?.c ?? 0,
    unresolvedConflicts: openConflicts?.c ?? 0,
  };
}

export async function createAnalysisJob(documentIds: string[]) {
  const [row] = await db
    .insert(analysisJobs)
    .values({
      status: "pending",
      totalDocuments: documentIds.length,
      documentIds: documentIds as unknown as object,
    })
    .returning();
  return row!;
}

export async function updateAnalysisJob(
  id: string,
  patch: Partial<typeof analysisJobs.$inferInsert>,
) {
  const [row] = await db.update(analysisJobs).set(patch).where(eq(analysisJobs.id, id)).returning();
  return row!;
}

export async function listAnalysisJobs(limit = 20) {
  return db.select().from(analysisJobs).orderBy(desc(analysisJobs.createdAt)).limit(limit);
}

export async function listExistingPaths(limit = 200): Promise<string[]> {
  const rows = await db.select({ path: documents.path }).from(documents).limit(limit);
  return rows.map((r) => r.path);
}

export async function documentsWithoutEmbeddings(): Promise<Document[]> {
  return db
    .select()
    .from(documents)
    .where(eq(documents.chunkCount, 0));
}
