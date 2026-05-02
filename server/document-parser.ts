import mammoth from "mammoth";
import JSZip from "jszip";

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  md: "text/plain",
};

export function getMimeTypeFromFilename(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? MIME_BY_EXT[ext] ?? null : null;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const mod = (await import("pdf-parse")) as unknown as {
    default: (data: Buffer) => Promise<{ text: string }>;
  };
  const result = await mod.default(buffer);
  return result.text;
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => n.startsWith("ppt/slides/slide") && n.endsWith(".xml"))
    .sort();
  const parts: string[] = [];
  for (const name of slideFiles) {
    const xml = await zip.files[name]!.async("string");
    const text = xml
      .replace(/<a:p[^>]*>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

async function extractXlsxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  let sharedStrings: string[] = [];
  const sharedFile = zip.files["xl/sharedStrings.xml"];
  if (sharedFile) {
    const xml = await sharedFile.async("string");
    sharedStrings = Array.from(xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((m) => m[1] ?? "");
  }
  const sheetNames = Object.keys(zip.files)
    .filter((n) => n.startsWith("xl/worksheets/sheet") && n.endsWith(".xml"))
    .sort();
  const out: string[] = [];
  for (const name of sheetNames) {
    const xml = await zip.files[name]!.async("string");
    const cells = Array.from(xml.matchAll(/<c[^>]*?(?:\s+t="(\w+)")?[^>]*>([\s\S]*?)<\/c>/g));
    const row: string[] = [];
    for (const m of cells) {
      const type = m[1];
      const inner = m[2] ?? "";
      const valueMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
      if (!valueMatch) continue;
      const value = valueMatch[1] ?? "";
      if (type === "s") {
        const idx = parseInt(value, 10);
        if (!Number.isNaN(idx) && sharedStrings[idx]) row.push(sharedStrings[idx]!);
      } else {
        row.push(value);
      }
    }
    if (row.length) out.push(row.join(" "));
  }
  return out.join("\n");
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string | null,
): Promise<string> {
  switch (mimeType) {
    case "application/pdf":
      return extractPdfText(buffer);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return extractDocxText(buffer);
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return extractPptxText(buffer);
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return extractXlsxText(buffer);
    case "text/plain":
      return buffer.toString("utf8");
    default:
      return buffer.toString("utf8");
  }
}
