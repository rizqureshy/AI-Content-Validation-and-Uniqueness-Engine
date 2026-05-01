import express from "express";
import { env } from "./env.js";
import { ensureExtensions } from "./db.js";
import { router } from "./routes.js";

async function main() {
  await ensureExtensions();

  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  app.get("/healthz", (_req, res) => res.json({ ok: true }));
  app.use("/api", router);

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
  });

  app.listen(env.PORT, () => {
    console.log(`DocuInsight server listening on http://localhost:${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
