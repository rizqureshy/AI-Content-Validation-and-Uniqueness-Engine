import { chunkText } from "./chunker.js";
import { embedTexts } from "./cohere.js";
import {
  analyzeChunkPairForConflicts,
  explainChunkSimilarity,
  suggestLocation,
} from "./openai.js";
import {
  createConflict,
  deleteChunksForDocument,
  findSimilarChunks,
  getChunksForDocument,
  getDocument,
  insertChunks,
  listExistingPaths,
  recomputeDocumentAggregates,
  recordChunkSimilarity,
  updateDocument,
} from "./storage.js";
import { hasOpenAI } from "./env.js";
import { SIM_THRESHOLDS, type PrePublishCheckResult } from "../shared/schema.js";

export interface AnalysisResult {
  documentId: string;
  chunkCount: number;
  duplicates: number;
  similar: number;
  conflicts: number;
  noveltyScore: number;
}

export async function analyzeDocument(documentId: string): Promise<AnalysisResult> {
  const doc = await getDocument(documentId);
  if (!doc) throw new Error(`Document not found: ${documentId}`);
  if (!doc.content) throw new Error(`Document has no extracted content: ${documentId}`);

  await deleteChunksForDocument(documentId);

  const chunks = chunkText(doc.content);
  if (chunks.length === 0) {
    await updateDocument(documentId, {
      chunkCount: 0,
      noveltyScore: 1,
      analyzedAt: new Date(),
    });
    return {
      documentId,
      chunkCount: 0,
      duplicates: 0,
      similar: 0,
      conflicts: 0,
      noveltyScore: 1,
    };
  }

  const embeddings = await embedTexts(
    chunks.map((c) => c.text),
    "search_document",
  );

  const insertedChunks = await insertChunks(
    chunks.map((c, i) => ({
      documentId,
      chunkIndex: i,
      text: c.text,
      tokenCount: c.tokenCount,
      charStart: c.charStart,
      charEnd: c.charEnd,
      headingPath: c.headingPath ?? null,
      embedding: embeddings[i]!,
    })),
  );

  let duplicates = 0;
  let similar = 0;
  let conflictCount = 0;
  const topSimilarities: number[] = [];

  for (const chunk of insertedChunks) {
    if (!chunk.embedding) continue;
    const matches = await findSimilarChunks(
      chunk.embedding as number[],
      SIM_THRESHOLDS.store,
      documentId,
      20,
    );
    for (const m of matches) {
      await recordChunkSimilarity(
        chunk.id,
        m.chunkId,
        documentId,
        m.documentId,
        m.similarity,
      );
      topSimilarities.push(m.similarity);
      if (m.similarity >= SIM_THRESHOLDS.duplicate) duplicates++;
      else if (m.similarity >= SIM_THRESHOLDS.similar) similar++;

      if (m.similarity >= SIM_THRESHOLDS.conflictTrigger && hasOpenAI()) {
        try {
          const findings = await analyzeChunkPairForConflicts(
            chunk.text,
            m.text,
            doc.name,
            m.documentName,
            chunk.headingPath ?? undefined,
            m.headingPath ?? undefined,
          );
          for (const f of findings) {
            await createConflict({
              chunkId1: chunk.id,
              chunkId2: m.chunkId,
              documentId1: documentId,
              documentId2: m.documentId,
              conflictType: f.type,
              severity: f.severity,
              description: f.description,
              value1: f.value1,
              value2: f.value2,
              context1: f.context1,
              context2: f.context2,
            });
            conflictCount++;
          }
        } catch (err) {
          console.error("Conflict analysis failed:", err);
        }
      }
    }
  }

  const maxSim = topSimilarities.length ? Math.max(...topSimilarities) : 0;
  const noveltyScore = Math.max(0, 1 - maxSim);

  await updateDocument(documentId, {
    chunkCount: insertedChunks.length,
    noveltyScore,
    analyzedAt: new Date(),
  });

  await recomputeDocumentAggregates(documentId);

  return {
    documentId,
    chunkCount: insertedChunks.length,
    duplicates,
    similar,
    conflicts: conflictCount,
    noveltyScore,
  };
}

export async function prePublishCheck(input: {
  filename: string;
  text: string;
}): Promise<PrePublishCheckResult> {
  const chunks = chunkText(input.text);
  if (chunks.length === 0) {
    return {
      novelty: 1,
      conflicts: [],
      similarDocuments: [],
      suggestedLocation: "/",
      recommendation: "publish",
      issues: ["Empty document"],
    };
  }

  const embeddings = await embedTexts(
    chunks.map((c) => c.text),
    "search_query",
  );

  const matchesByDoc = new Map<
    string,
    {
      doc: { id: string; name: string; path: string };
      topSimilarity: number;
      pairs: Array<{
        newChunkText: string;
        existingChunkText: string;
        existingChunkId: string;
        existingChunkHeading: string | null;
        existingDocName: string;
        similarity: number;
      }>;
    }
  >();

  let globalMax = 0;

  for (let i = 0; i < chunks.length; i++) {
    const emb = embeddings[i];
    if (!emb) continue;
    const matches = await findSimilarChunks(emb, SIM_THRESHOLDS.similar, undefined, 10);
    for (const m of matches) {
      globalMax = Math.max(globalMax, m.similarity);
      const entry = matchesByDoc.get(m.documentId) ?? {
        doc: { id: m.documentId, name: m.documentName, path: m.documentPath },
        topSimilarity: 0,
        pairs: [],
      };
      entry.topSimilarity = Math.max(entry.topSimilarity, m.similarity);
      entry.pairs.push({
        newChunkText: chunks[i]!.text,
        existingChunkText: m.text,
        existingChunkId: m.chunkId,
        existingChunkHeading: m.headingPath,
        existingDocName: m.documentName,
        similarity: m.similarity,
      });
      matchesByDoc.set(m.documentId, entry);
    }
  }

  const conflictsOut: PrePublishCheckResult["conflicts"] = [];
  if (hasOpenAI()) {
    for (const entry of matchesByDoc.values()) {
      for (const pair of entry.pairs) {
        if (pair.similarity < SIM_THRESHOLDS.conflictTrigger) continue;
        try {
          const findings = await analyzeChunkPairForConflicts(
            pair.newChunkText,
            pair.existingChunkText,
            input.filename,
            entry.doc.name,
            undefined,
            pair.existingChunkHeading ?? undefined,
          );
          for (const f of findings) {
            conflictsOut.push({
              type: f.type,
              severity: f.severity,
              description: f.description,
              value1: f.value1,
              value2: f.value2,
              context1: f.context1,
              context2: f.context2,
              matchedDocument: entry.doc,
            });
          }
        } catch (err) {
          console.error("pre-publish conflict analysis failed:", err);
        }
      }
    }
  }

  const similarDocuments: PrePublishCheckResult["similarDocuments"] = [];
  for (const entry of matchesByDoc.values()) {
    const top = entry.pairs.sort((a, b) => b.similarity - a.similarity).slice(0, 3);
    const matched: PrePublishCheckResult["similarDocuments"][number]["matchedChunks"] = [];
    for (const p of top) {
      let explanation: string | undefined;
      if (hasOpenAI() && p.similarity >= SIM_THRESHOLDS.similar) {
        try {
          const ex = await explainChunkSimilarity(p.newChunkText, p.existingChunkText);
          explanation = [
            ex.sharedTopics.length ? `Shared topics: ${ex.sharedTopics.join(", ")}` : "",
            ex.sharedFacts.length ? `Shared facts: ${ex.sharedFacts.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join(" • ");
        } catch {
          /* ignore */
        }
      }
      matched.push({
        newChunkText: p.newChunkText,
        existingChunkText: p.existingChunkText,
        similarity: p.similarity,
        explanation,
      });
    }
    similarDocuments.push({
      document: entry.doc,
      topSimilarity: entry.topSimilarity,
      matchedChunks: matched,
    });
  }
  similarDocuments.sort((a, b) => b.topSimilarity - a.topSimilarity);

  let suggestedLocation = "/";
  if (hasOpenAI()) {
    try {
      const paths = await listExistingPaths();
      const sl = await suggestLocation(input.text, paths);
      suggestedLocation = sl.suggestedPath || "/";
    } catch {
      /* ignore */
    }
  }

  const novelty = Math.max(0, 1 - globalMax);
  const issues: string[] = [];
  let recommendation: PrePublishCheckResult["recommendation"] = "publish";
  const hasCritical = conflictsOut.some((c) => c.severity === "critical");
  const hasDuplicate = similarDocuments.some((s) => s.topSimilarity >= SIM_THRESHOLDS.duplicate);
  if (hasCritical) {
    recommendation = "reject";
    issues.push("Critical conflict detected with existing content");
  } else if (hasDuplicate) {
    recommendation = "review";
    issues.push("Near-duplicate content already exists in repository");
  } else if (conflictsOut.length > 0) {
    recommendation = "review";
    issues.push(`${conflictsOut.length} potential conflict(s) detected`);
  }
  if (novelty < 0.2 && recommendation === "publish") {
    recommendation = "review";
    issues.push("Low novelty: most content overlaps with existing documents");
  }

  return {
    novelty,
    conflicts: conflictsOut,
    similarDocuments,
    suggestedLocation,
    recommendation,
    issues,
  };
}

