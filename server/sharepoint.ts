import { env, hasSharepoint } from "./env.js";

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

const GRAPH = "https://graph.microsoft.com/v1.0";

async function getAccessTokenViaClientCredentials(): Promise<string> {
  if (!hasSharepoint()) {
    throw new Error("SharePoint credentials are not configured");
  }
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.token;
  }

  const url = `https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: env.MS_CLIENT_ID!,
    client_secret: env.MS_CLIENT_SECRET!,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Failed to get token: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return data.access_token;
}

async function graphFetch<T>(path: string): Promise<T> {
  const token = await getAccessTokenViaClientCredentials();
  const res = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Graph API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

async function graphFetchBinary(path: string): Promise<Buffer> {
  const token = await getAccessTokenViaClientCredentials();
  const res = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Graph API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export interface SharepointSiteInfo {
  id: string;
  displayName: string;
  webUrl: string;
}

export interface SharepointDriveItem {
  id: string;
  name: string;
  webUrl: string;
  size: number;
  file?: { mimeType?: string };
  folder?: { childCount: number };
  parentReference?: { path?: string };
  lastModifiedDateTime?: string;
}

export async function getSiteByPath(
  hostname: string,
  sitePath: string,
): Promise<SharepointSiteInfo> {
  return graphFetch<SharepointSiteInfo>(`/sites/${hostname}:/sites/${sitePath}`);
}

export async function getSiteDrive(siteId: string): Promise<{ id: string }> {
  return graphFetch<{ id: string }>(`/sites/${siteId}/drive`);
}

async function listChildren(driveId: string, itemId: string): Promise<SharepointDriveItem[]> {
  const data = await graphFetch<{ value: SharepointDriveItem[] }>(
    `/drives/${driveId}/items/${itemId}/children?$top=200`,
  );
  return data.value;
}

export async function listAllFiles(
  driveId: string,
  rootItemId = "root",
  maxDepth = 3,
): Promise<SharepointDriveItem[]> {
  const out: SharepointDriveItem[] = [];
  async function walk(itemId: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const children = await listChildren(driveId, itemId);
    for (const child of children) {
      if (child.file) {
        out.push(child);
      } else if (child.folder) {
        await walk(child.id, depth + 1);
      }
    }
  }
  await walk(rootItemId, 0);
  return out;
}

export async function getFileContent(driveId: string, itemId: string): Promise<Buffer> {
  return graphFetchBinary(`/drives/${driveId}/items/${itemId}/content`);
}

export async function isSharePointConnected(): Promise<boolean> {
  if (!hasSharepoint()) return false;
  try {
    await getAccessTokenViaClientCredentials();
    return true;
  } catch {
    return false;
  }
}
