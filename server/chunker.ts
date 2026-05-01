import { env } from "./env.js";

export interface Chunk {
  text: string;
  tokenCount: number;
  charStart: number;
  charEnd: number;
  headingPath?: string;
}

const APPROX_CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$|^([A-Z][A-Z0-9 \-]{4,})$/;

function detectHeading(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const md = trimmed.match(/^#{1,6}\s+(.+)$/);
  if (md) return md[1] ?? null;
  if (
    trimmed.length < 80 &&
    trimmed.length > 3 &&
    HEADING_RE.test(trimmed) &&
    !/[.!?]$/.test(trimmed)
  ) {
    return trimmed;
  }
  return null;
}

function splitIntoParagraphs(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const lines = text.split(/\n/);
  let cursor = 0;
  let buffer = "";
  let bufferStart = 0;

  const flush = (end: number) => {
    const trimmed = buffer.trim();
    if (trimmed.length > 0) {
      out.push({ text: trimmed, start: bufferStart, end });
    }
    buffer = "";
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineStart = cursor;
    cursor += line.length + 1;
    if (line.trim() === "") {
      flush(lineStart);
      bufferStart = cursor;
    } else {
      if (buffer === "") bufferStart = lineStart;
      buffer += (buffer ? "\n" : "") + line;
    }
  }
  flush(cursor);
  return out;
}

export function chunkText(rawText: string): Chunk[] {
  if (!rawText || !rawText.trim()) return [];

  const targetTokens = env.CHUNK_TOKEN_SIZE;
  const overlapTokens = env.CHUNK_OVERLAP_TOKENS;
  const targetChars = targetTokens * APPROX_CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * APPROX_CHARS_PER_TOKEN;

  const paragraphs = splitIntoParagraphs(rawText);
  const chunks: Chunk[] = [];

  let currentText = "";
  let currentStart = 0;
  let currentEnd = 0;
  let headingPath: string | undefined;

  const pushChunk = () => {
    const trimmed = currentText.trim();
    if (!trimmed) return;
    chunks.push({
      text: trimmed,
      tokenCount: estimateTokens(trimmed),
      charStart: currentStart,
      charEnd: currentEnd,
      headingPath,
    });
  };

  for (const para of paragraphs) {
    const headingCandidate = detectHeading(para.text);
    if (headingCandidate) {
      headingPath = headingCandidate;
      continue;
    }

    if (currentText.length === 0) {
      currentStart = para.start;
    }

    if (currentText.length + para.text.length + 2 <= targetChars) {
      currentText += (currentText ? "\n\n" : "") + para.text;
      currentEnd = para.end;
    } else {
      pushChunk();
      const tail = currentText.slice(Math.max(0, currentText.length - overlapChars));
      currentText = tail ? tail + "\n\n" + para.text : para.text;
      currentStart = tail ? Math.max(0, currentEnd - tail.length) : para.start;
      currentEnd = para.end;
    }

    while (currentText.length > targetChars * 1.5) {
      const sliceEnd = targetChars;
      const slice = currentText.slice(0, sliceEnd);
      chunks.push({
        text: slice.trim(),
        tokenCount: estimateTokens(slice),
        charStart: currentStart,
        charEnd: currentStart + slice.length,
        headingPath,
      });
      const overlap = currentText.slice(Math.max(0, sliceEnd - overlapChars), sliceEnd);
      currentText = overlap + currentText.slice(sliceEnd);
      currentStart = currentStart + sliceEnd - overlap.length;
    }
  }
  pushChunk();

  return chunks;
}
