// Concurrent HTTP probe for external URLs found in SCORM content. Uses Node's
// global fetch with a short timeout. HEAD first, falls back to a ranged GET if
// the server rejects HEAD (common for CDNs).

export interface UrlHealth {
  url: string;
  ok: boolean;
  status: number | null;
  statusText?: string;
  redirectedTo?: string;
  responseTimeMs: number;
  method: "HEAD" | "GET" | null;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_CONCURRENCY = 8;
const USER_AGENT = "SCORM-Doctor/1.0 (+health-check)";

async function probeOnce(
  url: string,
  method: "HEAD" | "GET",
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": USER_AGENT,
        accept: "*/*",
        ...(method === "GET" ? { range: "bytes=0-0" } : {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkUrl(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<UrlHealth> {
  const start = Date.now();
  try {
    let res = await probeOnce(url, "HEAD", timeoutMs);
    let method: "HEAD" | "GET" = "HEAD";
    if (res.status === 405 || res.status === 501 || res.status === 403) {
      try {
        res = await probeOnce(url, "GET", timeoutMs);
        method = "GET";
      } catch {
        // fall through with HEAD result
      }
    }
    const elapsed = Date.now() - start;
    const finalUrl = res.url && res.url !== url ? res.url : undefined;
    return {
      url,
      ok: res.ok,
      status: res.status,
      statusText: res.statusText || undefined,
      redirectedTo: finalUrl,
      responseTimeMs: elapsed,
      method,
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? `timeout after ${timeoutMs}ms`
          : err.message
        : String(err);
    return {
      url,
      ok: false,
      status: null,
      responseTimeMs: elapsed,
      method: null,
      error: message,
    };
  }
}

export async function checkUrls(
  urls: string[],
  opts: { concurrency?: number; timeoutMs?: number } = {},
): Promise<UrlHealth[]> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results: UrlHealth[] = new Array(urls.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= urls.length) return;
      results[idx] = await checkUrl(urls[idx]!, timeoutMs);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
