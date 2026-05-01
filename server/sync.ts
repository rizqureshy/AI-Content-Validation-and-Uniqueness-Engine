import { extractTextFromBuffer, getMimeTypeFromFilename } from "./document-parser.js";
import {
  getFileContent,
  getSiteByPath,
  getSiteDrive,
  listAllFiles,
} from "./sharepoint.js";
import { env } from "./env.js";
import {
  createDocument,
  getDocumentByItemId,
  updateDocument,
  upsertSite,
} from "./storage.js";

export interface SyncResult {
  siteId: string;
  scanned: number;
  added: number;
  updated: number;
  skipped: number;
  errors: Array<{ name: string; error: string }>;
}

export async function syncConfiguredSite(): Promise<SyncResult> {
  if (!env.MS_SHAREPOINT_HOSTNAME || !env.MS_SHAREPOINT_SITE) {
    throw new Error("MS_SHAREPOINT_HOSTNAME and MS_SHAREPOINT_SITE must be set");
  }
  const site = await getSiteByPath(env.MS_SHAREPOINT_HOSTNAME, env.MS_SHAREPOINT_SITE);
  const drive = await getSiteDrive(site.id);
  const stored = await upsertSite({
    siteId: site.id,
    siteName: site.displayName,
    siteUrl: site.webUrl,
    driveId: drive.id,
  });

  const files = await listAllFiles(drive.id);
  const result: SyncResult = {
    siteId: stored.id,
    scanned: files.length,
    added: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  for (const f of files) {
    try {
      const mime = f.file?.mimeType ?? getMimeTypeFromFilename(f.name);
      if (!mime) {
        result.skipped++;
        continue;
      }
      const buf = await getFileContent(drive.id, f.id);
      const text = await extractTextFromBuffer(buf, mime);
      const existing = await getDocumentByItemId(f.id);
      const path = `${f.parentReference?.path ?? ""}/${f.name}`;

      if (existing) {
        await updateDocument(existing.id, {
          name: f.name,
          path,
          mimeType: mime,
          size: f.size,
          content: text,
        });
        result.updated++;
      } else {
        await createDocument({
          siteId: stored.id,
          name: f.name,
          path,
          driveId: drive.id,
          itemId: f.id,
          mimeType: mime,
          size: f.size,
          content: text,
        });
        result.added++;
      }
    } catch (err) {
      result.errors.push({
        name: f.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}
