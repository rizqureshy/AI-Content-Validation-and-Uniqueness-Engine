// SCORM Doctor: full analysis of a SCORM zip from an in-memory buffer.

import JSZip from "jszip";
import {
  attachResourceHrefs,
  classifyScormVersion,
  parseManifest,
  type ScormItem,
  type ScormManifest,
  type ScormResource,
} from "./manifest.js";
import {
  ASSET_EXT_GROUPS,
  extOf,
  extractUrlsFromHtml,
  extractUrlsFromText,
  htmlToPlainText,
  isAbsoluteUrl,
  normalizeAbsolute,
  resolveInternal,
  wordCount,
} from "./content.js";
import { checkUrls, type UrlHealth } from "./url-health.js";

export interface UrlOccurrence {
  file: string;
  attribute: string;
  tag?: string;
}

export interface ExternalUrlEntry {
  url: string;
  occurrences: number;
  firstSeenIn: string;
  attributes: string[];
  health?: UrlHealth;
}

export interface InternalLinkIssue {
  fromFile: string;
  href: string;
  resolved: string;
}

export interface ItemReport {
  identifier: string;
  title: string;
  resourceHref: string | null;
  wordCount: number;
  urlCount: number;
  externalUrlCount: number;
  brokenLinkCount: number;
  children: ItemReport[];
}

export interface AssetSummary {
  totalFiles: number;
  totalBytes: number;
  byGroup: Record<string, { count: number; bytes: number }>;
  byExt: Record<string, number>;
  largestFiles: Array<{ path: string; bytes: number }>;
}

export interface ScormDoctorReport {
  filename: string;
  sizeBytes: number;
  scormVersion: string;
  packageType: string;
  detectedAuthoringTool: string | null;
  title: string;
  defaultOrganization: string | null;
  manifest: {
    schemaversion: string | null;
    schema: string | null;
    organizationCount: number;
    resourceCount: number;
  };
  organizations: Array<{
    identifier: string;
    title: string;
    items: ItemReport[];
  }>;
  resources: ScormResource[];
  assets: AssetSummary;
  totals: {
    items: number;
    htmlPages: number;
    wordCount: number;
    externalUrls: number;
    internalLinks: number;
    brokenInternalLinks: number;
  };
  externalUrls: ExternalUrlEntry[];
  internalIssues: InternalLinkIssue[];
  warnings: string[];
  durationEstimateMinutes: number;
  generatedAt: string;
  urlHealth: {
    checked: boolean;
    ok: number;
    broken: number;
    skipped: number;
  };
}

export interface AnalyzeOptions {
  filename: string;
  checkUrls?: boolean;
  urlConcurrency?: number;
  urlTimeoutMs?: number;
  maxUrlsToCheck?: number;
}

const HTML_EXTS = new Set(["html", "htm", "xhtml"]);
const SCANNABLE_EXTS = new Set([...HTML_EXTS, "js", "mjs", "css", "json", "xml", "txt"]);

function detectAuthoringTool(zipFilenames: string[], htmlSnippet: string): string | null {
  const names = zipFilenames.map((n) => n.toLowerCase());
  const hasAny = (needle: string) => names.some((n) => n.includes(needle));
  if (hasAny("/lib/rise-runtime") || hasAny("rise-runtime") || hasAny("scormdriver/rise"))
    return "Articulate Rise";
  if (hasAny("story_content/") || hasAny("storyline_content/") || hasAny("/story.html"))
    return "Articulate Storyline";
  if (hasAny("captivate") || hasAny("cprostartup") || hasAny("/cpm.js"))
    return "Adobe Captivate";
  if (hasAny("ispring")) return "iSpring";
  if (hasAny("/lectora") || hasAny("trivantis")) return "Lectora";
  if (hasAny("camtasia")) return "Camtasia";
  if (hasAny("h5p/") || hasAny("/h5p-")) return "H5P";
  if (htmlSnippet.includes("Articulate Rise")) return "Articulate Rise";
  if (htmlSnippet.includes("Articulate Storyline")) return "Articulate Storyline";
  if (/<meta[^>]+generator[^>]+captivate/i.test(htmlSnippet)) return "Adobe Captivate";
  return null;
}

function flattenItems(items: ScormItem[]): ScormItem[] {
  const out: ScormItem[] = [];
  const walk = (xs: ScormItem[]) => {
    for (const it of xs) {
      out.push(it);
      walk(it.children);
    }
  };
  walk(items);
  return out;
}

function groupForExt(ext: string): string {
  return ASSET_EXT_GROUPS[ext] ?? "other";
}

function buildAssetSummary(zip: JSZip): Promise<AssetSummary> {
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  return Promise.all(
    entries.map(async (file) => {
      const buf = await file.async("nodebuffer");
      return { path: file.name, bytes: buf.length };
    }),
  ).then((rows) => {
    const byGroup: Record<string, { count: number; bytes: number }> = {};
    const byExt: Record<string, number> = {};
    let totalBytes = 0;
    for (const r of rows) {
      const ext = extOf(r.path) || "(none)";
      const grp = groupForExt(ext);
      byGroup[grp] ??= { count: 0, bytes: 0 };
      byGroup[grp].count++;
      byGroup[grp].bytes += r.bytes;
      byExt[ext] = (byExt[ext] ?? 0) + 1;
      totalBytes += r.bytes;
    }
    const largestFiles = [...rows].sort((a, b) => b.bytes - a.bytes).slice(0, 10);
    return {
      totalFiles: rows.length,
      totalBytes,
      byGroup,
      byExt,
      largestFiles,
    };
  });
}

function findManifestPath(zip: JSZip): string | null {
  const exact = zip.file("imsmanifest.xml");
  if (exact) return "imsmanifest.xml";
  const candidates = Object.keys(zip.files).filter(
    (n) => n.toLowerCase().endsWith("/imsmanifest.xml") || n.toLowerCase() === "imsmanifest.xml",
  );
  candidates.sort((a, b) => a.split("/").length - b.split("/").length);
  return candidates[0] ?? null;
}

export async function analyzeScormPackage(
  buffer: Buffer,
  opts: AnalyzeOptions,
): Promise<ScormDoctorReport> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(buffer).catch((err) => {
    throw new Error(`Could not open as zip: ${err instanceof Error ? err.message : String(err)}`);
  });

  const manifestPath = findManifestPath(zip);
  if (!manifestPath) {
    throw new Error(
      "imsmanifest.xml not found — this does not look like a SCORM package.",
    );
  }
  // Most authoring tools place the manifest at the package root; if it's nested,
  // remember the prefix so we resolve resource hrefs against the right base.
  const baseDir = manifestPath.includes("/")
    ? manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1)
    : "";

  const manifestXml = await zip.file(manifestPath)!.async("string");
  let manifest: ScormManifest;
  try {
    manifest = parseManifest(manifestXml);
  } catch (err) {
    throw new Error(
      `Invalid imsmanifest.xml: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  attachResourceHrefs(manifest.organizations, manifest.resources);

  const allFiles = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
  const sniffHtml = await (async () => {
    const htmlEntry = allFiles.find((n) => /\.html?$/i.test(n));
    if (!htmlEntry) return "";
    return zip.file(htmlEntry)!.async("string").catch(() => "");
  })();
  const detectedAuthoringTool = detectAuthoringTool(allFiles, sniffHtml);
  const scormVersion = classifyScormVersion(manifest);

  // Build a quick lookup for case-insensitive package members.
  const filesLower = new Map<string, string>();
  for (const n of allFiles) filesLower.set(n.toLowerCase(), n);

  const resolvePackagePath = (rel: string): string | null => {
    const candidates = [
      rel,
      baseDir + rel,
      decodeURIComponent(rel),
      decodeURIComponent(baseDir + rel),
    ];
    for (const c of candidates) {
      if (zip.file(c)) return c;
      const ci = filesLower.get(c.toLowerCase());
      if (ci) return ci;
    }
    return null;
  };

  // Collect HTML-bearing files referenced by any resource.
  const htmlFilesToScan = new Set<string>();
  const allReferencedFiles = new Set<string>();
  for (const r of manifest.resources) {
    for (const f of [r.href, ...r.files].filter(Boolean) as string[]) {
      const resolved = resolvePackagePath(f);
      if (!resolved) continue;
      allReferencedFiles.add(resolved);
      const ext = extOf(resolved);
      if (HTML_EXTS.has(ext)) htmlFilesToScan.add(resolved);
    }
  }
  // Also scan any HTML at the package root that's not yet covered (defensive).
  for (const n of allFiles) {
    if (HTML_EXTS.has(extOf(n))) htmlFilesToScan.add(n);
  }

  const externalMap = new Map<string, { occurrences: UrlOccurrence[] }>();
  const internalIssues: InternalLinkIssue[] = [];
  const wordCountByFile = new Map<string, number>();
  const urlCountByFile = new Map<string, number>();
  const externalUrlCountByFile = new Map<string, number>();
  const brokenLinksByFile = new Map<string, number>();

  const recordExternal = (url: string, file: string, attribute: string, tag?: string) => {
    const norm = normalizeAbsolute(url);
    if (!norm) return;
    const entry = externalMap.get(norm) ?? { occurrences: [] };
    entry.occurrences.push({ file, attribute, tag });
    externalMap.set(norm, entry);
    externalUrlCountByFile.set(file, (externalUrlCountByFile.get(file) ?? 0) + 1);
  };

  for (const file of htmlFilesToScan) {
    const html = await zip.file(file)!.async("string").catch(() => "");
    if (!html) {
      warnings.push(`Could not read referenced HTML file: ${file}`);
      continue;
    }
    const text = htmlToPlainText(html);
    wordCountByFile.set(file, wordCount(text));
    const urls = extractUrlsFromHtml(html);
    urlCountByFile.set(file, urls.length);
    for (const u of urls) {
      if (isAbsoluteUrl(u.url)) {
        recordExternal(u.url, file, u.attribute, u.tag);
      } else {
        const resolved = resolveInternal(file, u.url);
        if (!resolved) continue;
        const exists = !!zip.file(resolved) || !!filesLower.get(resolved.toLowerCase());
        if (!exists) {
          internalIssues.push({ fromFile: file, href: u.url, resolved });
          brokenLinksByFile.set(file, (brokenLinksByFile.get(file) ?? 0) + 1);
        }
      }
    }
    // Scan inline scripts/text for stray plain URLs the attribute scanner missed.
    for (const u of extractUrlsFromText(text)) {
      recordExternal(u.url, file, "text");
    }
  }

  // Also peek inside small JS/CSS files to surface URLs hidden in bundles.
  // Exclude the manifest itself — its xmlns attributes are schema namespaces,
  // not content URLs, and they would pollute the external URL list.
  const ancillary = allFiles.filter((n) => {
    if (n === manifestPath) return false;
    const ext = extOf(n);
    return SCANNABLE_EXTS.has(ext) && !HTML_EXTS.has(ext);
  });
  for (const file of ancillary) {
    const f = zip.file(file);
    if (!f) continue;
    const buf = await f.async("nodebuffer");
    if (buf.length > 1_500_000) continue; // skip huge bundles
    const text = buf.toString("utf8");
    for (const u of extractUrlsFromText(text)) {
      recordExternal(u.url, file, "text");
    }
  }

  // External URL list, sorted by occurrence count desc.
  const externalUrls: ExternalUrlEntry[] = Array.from(externalMap.entries()).map(
    ([url, { occurrences }]) => {
      const attrs = Array.from(new Set(occurrences.map((o) => o.attribute))).sort();
      return {
        url,
        occurrences: occurrences.length,
        firstSeenIn: occurrences[0]!.file,
        attributes: attrs,
      };
    },
  );
  externalUrls.sort((a, b) => b.occurrences - a.occurrences);

  // Optional URL health check.
  const shouldCheck = opts.checkUrls ?? true;
  const maxToCheck = opts.maxUrlsToCheck ?? 200;
  let healthSummary = { checked: false, ok: 0, broken: 0, skipped: 0 };
  if (shouldCheck && externalUrls.length) {
    const sliced = externalUrls.slice(0, maxToCheck);
    const skipped = externalUrls.length - sliced.length;
    const results = await checkUrls(
      sliced.map((e) => e.url),
      { concurrency: opts.urlConcurrency, timeoutMs: opts.urlTimeoutMs },
    );
    for (let i = 0; i < sliced.length; i++) {
      sliced[i]!.health = results[i];
    }
    const ok = results.filter((r) => r.ok).length;
    healthSummary = { checked: true, ok, broken: results.length - ok, skipped };
  }

  // Build per-item reports.
  const itemHrefStats = (resourceHref: string | null) => {
    if (!resourceHref) return { wc: 0, urls: 0, ext: 0, broken: 0 };
    const resolved = resolvePackagePath(resourceHref);
    const file = resolved ?? resourceHref;
    return {
      wc: wordCountByFile.get(file) ?? 0,
      urls: urlCountByFile.get(file) ?? 0,
      ext: externalUrlCountByFile.get(file) ?? 0,
      broken: brokenLinksByFile.get(file) ?? 0,
    };
  };

  const toItemReport = (it: ScormItem): ItemReport => {
    const stats = itemHrefStats(it.resourceHref ?? null);
    const childReports = it.children.map(toItemReport);
    const aggregate = childReports.reduce(
      (acc, c) => {
        acc.wc += c.wordCount;
        acc.urls += c.urlCount;
        acc.ext += c.externalUrlCount;
        acc.broken += c.brokenLinkCount;
        return acc;
      },
      { wc: stats.wc, urls: stats.urls, ext: stats.ext, broken: stats.broken },
    );
    return {
      identifier: it.identifier,
      title: it.title,
      resourceHref: it.resourceHref ?? null,
      wordCount: aggregate.wc,
      urlCount: aggregate.urls,
      externalUrlCount: aggregate.ext,
      brokenLinkCount: aggregate.broken,
      children: childReports,
    };
  };

  const orgs = manifest.organizations.map((o) => ({
    identifier: o.identifier,
    title: o.title,
    items: o.items.map(toItemReport),
  }));

  const allItems = manifest.organizations.flatMap((o) => flattenItems(o.items));
  const totalWords = Array.from(wordCountByFile.values()).reduce((a, b) => a + b, 0);
  // Rough reading-pace estimate: ~180 wpm for instructional content.
  const durationEstimateMinutes = Math.round(totalWords / 180);

  const assets = await buildAssetSummary(zip);

  if (manifest.resources.length === 0) warnings.push("Manifest has no <resources> declared.");
  if (manifest.organizations.length === 0)
    warnings.push("Manifest has no <organizations> declared.");
  if (htmlFilesToScan.size === 0)
    warnings.push("No HTML content was found inside the package.");

  return {
    filename: opts.filename,
    sizeBytes: buffer.length,
    scormVersion,
    packageType: detectedAuthoringTool ? `${detectedAuthoringTool} (${scormVersion})` : scormVersion,
    detectedAuthoringTool,
    title: manifest.title ?? opts.filename,
    defaultOrganization: manifest.defaultOrganizationId,
    manifest: {
      schemaversion: manifest.schemaversion,
      schema: manifest.schema,
      organizationCount: manifest.organizations.length,
      resourceCount: manifest.resources.length,
    },
    organizations: orgs,
    resources: manifest.resources,
    assets,
    totals: {
      items: allItems.length,
      htmlPages: htmlFilesToScan.size,
      wordCount: totalWords,
      externalUrls: externalUrls.length,
      internalLinks: Array.from(urlCountByFile.values()).reduce((a, b) => a + b, 0),
      brokenInternalLinks: internalIssues.length,
    },
    externalUrls,
    internalIssues,
    warnings,
    durationEstimateMinutes,
    generatedAt: new Date().toISOString(),
    urlHealth: healthSummary,
  };
}
