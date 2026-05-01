import OpenAI from "openai";
import { env, hasOpenAI } from "./env.js";
import type { ConflictType, Severity } from "../shared/schema.js";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!hasOpenAI()) throw new Error("OPENAI_API_KEY is not configured");
  if (!client) client = new OpenAI({ apiKey: env.OPENAI_API_KEY! });
  return client;
}

export interface ConflictFinding {
  type: ConflictType;
  severity: Severity;
  description: string;
  value1?: string;
  value2?: string;
  context1?: string;
  context2?: string;
}

export interface SimilarityExplanation {
  sharedTopics: string[];
  sharedFacts: string[];
  keyOverlaps: string[];
  differentiators: string[];
}

export interface NoveltyAnalysis {
  noveltyScore: number;
  reasoning: string;
}

export interface LocationSuggestion {
  suggestedPath: string;
  reasoning: string;
}

const MODEL_FAST = "gpt-4o-mini";
const MODEL_SMART = "gpt-4o";

async function chatJson<T>(model: string, system: string, user: string): Promise<T> {
  const openai = getClient();
  const res = await openai.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty response");
  return JSON.parse(content) as T;
}

const CONFLICT_SYSTEM = `You are a content validation analyst. Compare two short passages from
different documents and identify CONCRETE conflicts: numerical (different counts, amounts,
percentages), date (contradicting dates), factual (contradicting statements), or entity (different
names/details for the same entity). Only report a conflict when the two passages clearly disagree
about the same thing. Return JSON: {"conflicts":[{"type":"numerical|date|factual|entity",
"severity":"critical|warning|info","description":"...","value1":"...","value2":"...",
"context1":"...","context2":"..."}]}`;

export async function analyzeChunkPairForConflicts(
  text1: string,
  text2: string,
  doc1Name: string,
  doc2Name: string,
  heading1?: string,
  heading2?: string,
): Promise<ConflictFinding[]> {
  const user = `Document A: ${doc1Name}${heading1 ? ` (section: ${heading1})` : ""}
Passage A:
"""${text1}"""

Document B: ${doc2Name}${heading2 ? ` (section: ${heading2})` : ""}
Passage B:
"""${text2}"""`;

  const out = await chatJson<{ conflicts?: ConflictFinding[] }>(
    MODEL_SMART,
    CONFLICT_SYSTEM,
    user,
  );
  return out.conflicts ?? [];
}

const EXPLAIN_SYSTEM = `You explain why two passages are similar. Output JSON with arrays:
sharedTopics, sharedFacts, keyOverlaps, differentiators. Keep each array item under 18 words.`;

export async function explainChunkSimilarity(
  text1: string,
  text2: string,
): Promise<SimilarityExplanation> {
  const user = `Passage A:\n"""${text1}"""\n\nPassage B:\n"""${text2}"""`;
  const out = await chatJson<SimilarityExplanation>(MODEL_FAST, EXPLAIN_SYSTEM, user);
  return {
    sharedTopics: out.sharedTopics ?? [],
    sharedFacts: out.sharedFacts ?? [],
    keyOverlaps: out.keyOverlaps ?? [],
    differentiators: out.differentiators ?? [],
  };
}

const LOCATION_SYSTEM = `Suggest the best folder path for a new document given examples of
existing folder paths and the document content. Return JSON: {"suggestedPath":"...","reasoning":"..."}`;

export async function suggestLocation(
  newContent: string,
  existingPaths: string[],
): Promise<LocationSuggestion> {
  const user = `Existing paths (sample):\n${existingPaths.slice(0, 30).join("\n")}\n\nNew document content (excerpt):\n"""${newContent.slice(0, 4000)}"""`;
  return chatJson<LocationSuggestion>(MODEL_FAST, LOCATION_SYSTEM, user);
}
