// HTML/JS scanning for SCORM content. We extract URLs, asset references and
// approximate word counts without pulling in a heavy DOM parser.

import path from "node:path";

export interface ExtractedUrl {
  url: string;
  attribute: string; // href, src, action, data, poster, srcset, css-url
  tag?: string;
}

const ATTR_RE = /<([a-zA-Z][\w:-]*)\b([^>]*?)\/?>(?!\s*<\/script>)/g;
const ATTR_KV_RE = /([A-Za-z_][\w:-]*)\s*=\s*"([^"]*)"|([A-Za-z_][\w:-]*)\s*=\s*'([^']*)'/g;
const SRCSET_PARTS_RE = /([^,\s]+)(?:\s+[^,]*)?/g;
const CSS_URL_RE = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
const SCRIPT_URL_RE = /["'](https?:\/\/[^"'\s<>]+)["']/g;
const PLAIN_URL_RE = /https?:\/\/[^\s"'<>)]+/g;

function pushUrl(out: ExtractedUrl[], raw: string, attribute: string, tag?: string) {
  const url = raw.trim();
  if (!url) return;
  if (url.startsWith("javascript:") || url.startsWith("mailto:") || url.startsWith("tel:")) return;
  if (url.startsWith("#") || url.startsWith("data:")) return;
  out.push({ url, attribute, tag });
}

function readAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_KV_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_KV_RE.exec(raw))) {
    const k = (m[1] ?? m[3])!.toLowerCase();
    const v = m[2] ?? m[4] ?? "";
    out[k] = v;
  }
  return out;
}

export function extractUrlsFromHtml(html: string): ExtractedUrl[] {
  const out: ExtractedUrl[] = [];

  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(html))) {
    const tag = m[1]!.toLowerCase();
    const attrs = readAttrs(m[2] ?? "");
    if (attrs.href) pushUrl(out, attrs.href, "href", tag);
    if (attrs.src) pushUrl(out, attrs.src, "src", tag);
    if (attrs.action) pushUrl(out, attrs.action, "action", tag);
    if (attrs.data) pushUrl(out, attrs.data, "data", tag);
    if (attrs.poster) pushUrl(out, attrs.poster, "poster", tag);
    if (attrs.srcset) {
      SRCSET_PARTS_RE.lastIndex = 0;
      let sm: RegExpExecArray | null;
      while ((sm = SRCSET_PARTS_RE.exec(attrs.srcset))) {
        pushUrl(out, sm[1] ?? "", "srcset", tag);
      }
    }
    if (attrs.style) {
      let sm: RegExpExecArray | null;
      while ((sm = CSS_URL_RE.exec(attrs.style))) {
        pushUrl(out, sm[1] ?? "", "css-url", tag);
      }
      CSS_URL_RE.lastIndex = 0;
    }
  }

  CSS_URL_RE.lastIndex = 0;
  let sm: RegExpExecArray | null;
  while ((sm = CSS_URL_RE.exec(html))) pushUrl(out, sm[1] ?? "", "css-url");

  // Catch URLs hard-coded inside inline scripts / data blobs.
  SCRIPT_URL_RE.lastIndex = 0;
  while ((sm = SCRIPT_URL_RE.exec(html))) pushUrl(out, sm[1] ?? "", "script-literal");

  return out;
}

export function extractUrlsFromText(text: string): ExtractedUrl[] {
  const out: ExtractedUrl[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  PLAIN_URL_RE.lastIndex = 0;
  while ((m = PLAIN_URL_RE.exec(text))) {
    let url = m[0]!;
    url = url.replace(/[).,;:!?]+$/, "");
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, attribute: "text" });
  }
  return out;
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function wordCount(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}

export function isAbsoluteUrl(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) || url.startsWith("//");
}

export function normalizeAbsolute(url: string): string | null {
  try {
    if (url.startsWith("//")) url = "https:" + url;
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

// Resolve a relative href inside the package back to a normalized zip-relative path.
export function resolveInternal(fromFile: string, href: string): string | null {
  if (isAbsoluteUrl(href)) return null;
  const cleaned = href.split("#")[0]!.split("?")[0]!;
  if (!cleaned) return null;
  const base = path.posix.dirname(fromFile);
  const joined = path.posix.normalize(path.posix.join(base, cleaned));
  return joined.replace(/^\.\//, "");
}

export const ASSET_EXT_GROUPS: Record<string, string> = {
  html: "html",
  htm: "html",
  xhtml: "html",
  js: "script",
  mjs: "script",
  css: "style",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  svg: "image",
  webp: "image",
  ico: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  m4v: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  m4a: "audio",
  pdf: "document",
  doc: "document",
  docx: "document",
  ppt: "document",
  pptx: "document",
  xls: "document",
  xlsx: "document",
  json: "data",
  xml: "data",
  txt: "data",
  vtt: "captions",
  srt: "captions",
  woff: "font",
  woff2: "font",
  ttf: "font",
  otf: "font",
  eot: "font",
};

export function extOf(filename: string): string {
  const m = /\.([^./\\]+)$/.exec(filename);
  return m ? m[1]!.toLowerCase() : "";
}
