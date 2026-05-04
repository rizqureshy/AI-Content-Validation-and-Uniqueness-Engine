import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { hasCohere, hasOpenAI, hasSharepoint } from "./env.js";
import { isSharePointConnected } from "./sharepoint.js";
import { extractTextFromBuffer, getMimeTypeFromFilename } from "./document-parser.js";
import { analyzeDocument, prePublishCheck } from "./analysis.js";
import { analyzeScormPackage } from "./scorm/analyze.js";
import { syncConfiguredSite } from "./sync.js";
import {
  categoryDocuments,
  createAnalysisJob,
  getDocument,
  listAnalysisJobs,
  listConflicts,
  listDocuments,
  listSimilarities,
  listSites,
  recentConflicts,
  recentDocuments,
  repositoryHealth,
  resolveConflict,
  updateAnalysisJob,
} from "./storage.js";

export const router = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const scormUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

router.get("/health", async (_req, res) => {
  const stats = await repositoryHealth();
  res.json(stats);
});

router.get("/settings/status", async (_req, res) => {
  res.json({
    sharepoint: { configured: hasSharepoint(), connected: await isSharePointConnected() },
    cohere: { configured: hasCohere() },
    openai: { configured: hasOpenAI() },
  });
});

router.get("/documents", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const data = await listDocuments(limit, offset);
  res.json({ data, limit, offset });
});

router.get("/documents/recent", async (_req, res) => {
  res.json({ data: await recentDocuments(10) });
});

router.get("/documents/:id", async (req, res) => {
  const doc = await getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: "Not found" });
  res.json(doc);
});

router.post("/documents/:id/analyze", async (req, res) => {
  try {
    const result = await analyzeDocument(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/documents/pre-publish-check", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file is required" });
  try {
    const mime = req.file.mimetype || getMimeTypeFromFilename(req.file.originalname);
    const text = await extractTextFromBuffer(req.file.buffer, mime ?? null);
    const result = await prePublishCheck({ filename: req.file.originalname, text });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/scorm/analyze", scormUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file is required" });
  try {
    const checkUrlsParam = String(req.query.checkUrls ?? req.body?.checkUrls ?? "true");
    const report = await analyzeScormPackage(req.file.buffer, {
      filename: req.file.originalname,
      checkUrls: checkUrlsParam !== "false",
    });
    res.json(report);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/conflicts", async (_req, res) => {
  res.json({ data: await listConflicts({ resolved: false, limit: 200 }) });
});

router.get("/conflicts/recent", async (_req, res) => {
  res.json({ data: await recentConflicts(10) });
});

router.patch("/conflicts/:id/resolve", async (req, res) => {
  const row = await resolveConflict(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

router.get("/similarities", async (_req, res) => {
  res.json({ data: await listSimilarities(200) });
});

const categorySchema = z.enum(["duplicates", "similar", "novel", "conflicts"]);

router.get("/analysis/documents", async (req, res) => {
  const parsed = categorySchema.safeParse(req.query.category);
  if (!parsed.success) return res.status(400).json({ error: "invalid category" });
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  const { data, total } = await categoryDocuments({
    category: parsed.data,
    limit,
    offset,
  });
  res.json({ data, total, limit, offset });
});

router.post("/analysis/run", async (req, res) => {
  const ids: string[] = Array.isArray(req.body?.documentIds)
    ? req.body.documentIds
    : (await listDocuments(1000)).map((d) => d.id);

  const job = await createAnalysisJob(ids);
  res.json(job);

  (async () => {
    try {
      await updateAnalysisJob(job.id, { status: "running", startedAt: new Date(), progress: 0 });
      let done = 0;
      for (const id of ids) {
        try {
          await analyzeDocument(id);
        } catch (err) {
          console.error(`analyze ${id} failed:`, err);
        }
        done++;
        if (done % 5 === 0 || done === ids.length) {
          await updateAnalysisJob(job.id, { progress: done });
        }
      }
      await updateAnalysisJob(job.id, {
        status: "completed",
        progress: ids.length,
        completedAt: new Date(),
      });
    } catch (err) {
      await updateAnalysisJob(job.id, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      });
    }
  })();
});

router.get("/analysis/jobs", async (_req, res) => {
  res.json({ data: await listAnalysisJobs() });
});

router.get("/sharepoint/sites", async (_req, res) => {
  res.json({ data: await listSites() });
});

router.post("/sharepoint/sync", async (_req, res) => {
  try {
    const result = await syncConfiguredSite();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
