import "dotenv/config";
import { embedSingle } from "../server/cohere.js";
import { explainChunkSimilarity, analyzeChunkPairForConflicts } from "../server/openai.js";

async function main() {
  console.log("Testing Cohere embed…");
  try {
    const v = await embedSingle("hello world", "search_document");
    console.log(`  ok: dim=${v.length}, first=${v[0]?.toFixed(4)}`);
  } catch (e) {
    console.log(`  FAIL: ${(e as Error).message}`);
  }

  console.log("Testing OpenAI explainChunkSimilarity…");
  try {
    const ex = await explainChunkSimilarity(
      "Revenue grew to $5M in 2024.",
      "The company posted $5M revenue in fiscal 2024.",
    );
    console.log(`  ok: sharedFacts=${ex.sharedFacts.length} differentiators=${ex.differentiators.length}`);
  } catch (e) {
    console.log(`  FAIL: ${(e as Error).message}`);
  }

  console.log("Testing OpenAI analyzeChunkPairForConflicts…");
  try {
    const c = await analyzeChunkPairForConflicts(
      "Revenue in 2024 was $5M.",
      "Revenue in 2024 was $7M.",
      "DocA",
      "DocB",
    );
    console.log(`  ok: conflicts found=${c.length}; first=${JSON.stringify(c[0] ?? null)}`);
  } catch (e) {
    console.log(`  FAIL: ${(e as Error).message}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
