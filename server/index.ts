import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { env } from "./env.js";
import { ensureExtensions } from "./db.js";
import { router } from "./routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  if (env.NODE_ENV === "production") {
    const candidates = [
      path.resolve(__dirname, "../client"),
      path.resolve(process.cwd(), "dist/client"),
    ];
    const clientDir = candidates.find((p) => fs.existsSync(path.join(p, "index.html")));
    if (clientDir) {
      console.log(`Serving static client from ${clientDir}`);
      app.use(express.static(clientDir));
      app.get(/^(?!\/api|\/healthz).*/, (_req, res) => {
        res.sendFile(path.join(clientDir, "index.html"));
      });
    } else {
      console.warn("Production build not found; static client disabled.");
    }
  }

  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error("Unhandled error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    },
  );

  const port = Number(process.env.PORT) || env.PORT;
  app.listen(port, "0.0.0.0", () => {
    console.log(`DocuInsight server listening on 0.0.0.0:${port}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
