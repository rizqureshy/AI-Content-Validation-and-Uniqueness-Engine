import { CohereClient } from "cohere-ai";
import { env, hasCohere } from "./env.js";

let client: CohereClient | null = null;

function getClient(): CohereClient {
  if (!hasCohere()) {
    throw new Error("COHERE_API_KEY is not configured");
  }
  if (!client) {
    client = new CohereClient({ token: env.COHERE_API_KEY! });
  }
  return client;
}

export type EmbedInputType = "search_document" | "search_query";

const MODEL = "embed-english-v3.0";

const BATCH_SIZE = 96;

async function withRetry<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const wait = Math.min(8000, 500 * 2 ** i);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Cohere request failed");
}

export async function embedTexts(
  texts: string[],
  inputType: EmbedInputType,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const cohere = getClient();
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await withRetry(() =>
      cohere.embed({
        model: MODEL,
        texts: batch,
        inputType,
        embeddingTypes: ["float"],
      }),
    );

    const embeddings = (res as { embeddings: { float?: number[][] } | number[][] }).embeddings;
    let vectors: number[][] = [];
    if (Array.isArray(embeddings)) {
      vectors = embeddings as number[][];
    } else if (embeddings && Array.isArray(embeddings.float)) {
      vectors = embeddings.float;
    }
    if (vectors.length !== batch.length) {
      throw new Error(
        `Cohere embedding count mismatch: expected ${batch.length}, got ${vectors.length}`,
      );
    }
    out.push(...vectors);
  }
  return out;
}

export async function embedSingle(text: string, inputType: EmbedInputType): Promise<number[]> {
  const [vec] = await embedTexts([text], inputType);
  if (!vec) throw new Error("Failed to embed text");
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("Vector length mismatch");
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
