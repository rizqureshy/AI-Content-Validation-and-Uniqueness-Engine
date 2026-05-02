# DocuInsight

AI-powered Document Intelligence & Knowledge Management Platform. Connects to SharePoint,
chunks and embeds documents with **Cohere Embed**, stores vectors in **Postgres + pgvector**,
and uses **OpenAI GPT-4o** to detect conflicts (numerical, date, factual, entity) between
matched chunks.

## Architecture

```
SharePoint  ──>  Parse (PDF/DOCX/PPTX/XLSX/TXT)
                      │
                      ▼
                  Chunk (~800 tokens, 100 overlap, heading-aware)
                      │
                      ▼
                Cohere Embed (search_document) ──> pgvector (IVFFlat, cosine)
                                                          │
                                                          ▼
                                       Chunk-level similarity search
                                                          │
                                                          ▼
                                  GPT-4o conflict analysis on matched pairs
                                                          │
                                                          ▼
                          Document-level rollup: dup / similar / novel / conflicts
```

## Tech stack

| Layer        | Choice                                              |
|--------------|------------------------------------------------------|
| Frontend     | React 18 + Vite + TanStack Query + Wouter + Tailwind |
| Backend      | Node 20 + Express + TypeScript                       |
| ORM          | Drizzle                                              |
| Database     | Postgres 16 + pgvector                               |
| Embeddings   | Cohere `embed-english-v3.0` (1536 dims, swap-ready)  |
| LLM analysis | OpenAI `gpt-4o` (conflicts) + `gpt-4o-mini` (explain)|
| Source       | Microsoft Graph (SharePoint/OneDrive)                |

## Quick start (local)

```bash
cp .env.example .env   # fill in credentials
docker compose up -d   # starts pgvector
npm install
npm run db:push        # creates schema
npm run dev            # starts API on :3000 and Vite on :5173
```

Then:
1. Open http://localhost:5173
2. **Settings** — confirm Cohere / OpenAI / SharePoint show connected.
3. **Documents** — click *Sync SharePoint*, then *Analyze All*.
4. **Pre-publish** — drop a draft file to see chunk-level matches and conflicts.

## Deploy on Replit (Pro, private)

DocuInsight ships with `.replit` configured for a single-port production build:
Express serves both the REST API (`/api/*`) and the built React SPA. The server
binds to `0.0.0.0` and uses `process.env.PORT`.

### 1. Import the GitHub repo

1. Sign in to [Replit](https://replit.com) with your **Pro** account.
2. Click **Create Repl → Import from GitHub**.
3. Paste this repo URL and select the branch you want to deploy.
4. Confirm the language is detected as **Node.js**. Replit will read `.replit`
   and provision Node 20 + Postgres 16 modules.

### 2. Attach the built-in database

1. Open the **Database** tool in the left sidebar (or run `Tools → Database`).
2. Click **Create database** — Replit attaches a Neon-backed Postgres and
   injects `DATABASE_URL` automatically.
3. Replit's Postgres supports `pgvector` out of the box; the server runs
   `CREATE EXTENSION IF NOT EXISTS vector` on boot.

### 3. Set Secrets (never commit)

In the **Secrets** pane (Tools → Secrets), add:

| Key                       | Value                                                  |
|---------------------------|--------------------------------------------------------|
| `COHERE_API_KEY`          | from your Cohere dashboard                             |
| `OPENAI_API_KEY`          | from your OpenAI dashboard                             |
| `MS_TENANT_ID`            | Azure AD tenant ID                                     |
| `MS_CLIENT_ID`            | App registration client ID                             |
| `MS_CLIENT_SECRET`        | App registration secret **value** (not the secret ID)  |
| `MS_SHAREPOINT_HOSTNAME`  | e.g. `contoso.sharepoint.com`                          |
| `MS_SHAREPOINT_SITE`      | e.g. `ValueSite`                                       |
| `SESSION_SECRET`          | any long random string                                 |

`DATABASE_URL` and `PORT` are injected by Replit — do **not** set them yourself.

### 4. First-time schema apply

Open the Replit shell and run **once**:

```bash
npm run db:push
# or, if drizzle-kit's interactive prompt fails in the shell:
psql "$DATABASE_URL" -f drizzle/migrations/0000_bright_jetstream.sql
```

### 5. Run in dev mode (Workspace)

Click the green **Run** button. `.replit`'s `run = "npm run dev"` starts:
- Express API on port 3000
- Vite dev server on port 5173 (with HMR, proxying `/api` to 3000)

Replit forwards external port 80 to local port 3000, so the public URL hits the
API directly. The Vite HMR webview is available on its own preview tab.

### 6. Publish as a private Deployment

1. Click **Deploy** (top right).
2. Choose **Reserved VM** (recommended for stateful background analysis jobs)
   or **Autoscale**. The repo's `.replit` defaults to `deploymentTarget = "vm"`.
3. The **build** command is `npm ci && npm run build`. This produces:
   - `dist/client/` — the static React bundle
   - `dist/server/` — the compiled Node server
4. The **run** command is `npm start` → `node dist/server/index.js`. Express
   serves the API and the SPA on `$PORT` (Replit injects it).
5. Pick **Private** visibility (Pro accounts only) so only invited members can
   reach the deployment URL.
6. Click **Deploy**.

### 7. Verify

After the deployment goes live:

```bash
curl https://<your-deployment>.replit.app/api/settings/status
```

You should see all three integrations report `configured: true` and
`sharepoint.connected: true`. Then:

- **Documents → Sync SharePoint** to pull files
- **Documents → Analyze All** to chunk, embed, and detect conflicts
- **Pre-publish** to validate new drafts

### Replit deployment checklist

- [ ] `.replit` present with `deploymentTarget = "vm"`, build, and run commands
- [ ] Built-in Postgres database attached (`DATABASE_URL` injected)
- [ ] `pgvector` extension is created on boot (`server/db.ts` does this)
- [ ] All Secrets set; nothing sensitive committed to git (`.env` gitignored)
- [ ] First-time `db:push` (or `psql -f drizzle/migrations/...`) executed
- [ ] Server binds to `0.0.0.0:$PORT` (verified in `server/index.ts`)
- [ ] Production build serves SPA and `/api` from a single port
- [ ] Deployment visibility set to **Private**
- [ ] Azure AD app has `Sites.Read.All` and `Files.Read.All` Application
      permissions with admin consent
- [ ] After confirming things work, **rotate** the Cohere / OpenAI / Azure
      secrets if they were ever pasted into chat or shared docs
- [ ] If Replit blocks any outbound host, allowlist `api.cohere.com`,
      `api.openai.com`, `login.microsoftonline.com`, `graph.microsoft.com`
      (Pro Deployments allow all egress by default)

### Notes for Replit

- **File uploads** use `multer` in-memory storage (50 MB max). No disk
  persistence is required — uploaded drafts are parsed, embedded, and the
  buffer is discarded.
- **Background jobs** (`/api/analysis/run`) run inside the same Node process
  via `setImmediate`. A Reserved VM keeps the process alive between requests
  so long jobs complete; an Autoscale deployment may interrupt them.
- **Embeddings & GPT calls** require outbound HTTPS to `api.cohere.com` and
  `api.openai.com`. Replit Deployments allow this by default.
- **SharePoint sync** requires outbound HTTPS to `login.microsoftonline.com`
  and `graph.microsoft.com`.

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET    | /api/health | Repository health stats |
| GET    | /api/settings/status | Service connection status |
| GET    | /api/documents | Paginated document list |
| GET    | /api/documents/recent | Last 10 documents |
| GET    | /api/documents/:id | Single document |
| POST   | /api/documents/:id/analyze | Re-chunk, embed, find similar, detect conflicts |
| POST   | /api/documents/pre-publish-check | Multipart upload → verdict + chunk evidence |
| GET    | /api/conflicts | Open conflicts |
| PATCH  | /api/conflicts/:id/resolve | Mark resolved |
| GET    | /api/similarities | Top chunk similarity pairs |
| GET    | /api/analysis/documents?category=duplicates\|similar\|novel\|conflicts | Document-centric view |
| POST   | /api/analysis/run | Run batch analysis (background job) |
| GET    | /api/analysis/jobs | Job status |
| GET    | /api/sharepoint/sites | Synced sites |
| POST   | /api/sharepoint/sync | Pull from SharePoint |

## Similarity thresholds

| Score        | Bucket           |
|--------------|------------------|
| ≥ 0.80       | Duplicate chunk  |
| 0.50 – 0.79  | Similar chunk    |
| 0.30 – 0.49  | Stored, not flagged |
| < 0.30       | Discarded         |

Chunks scoring **≥ 0.60** trigger GPT-4o conflict analysis.

## Schema (key tables)

- `documents` — metadata + aggregated counts
- `document_chunks` — text + `vector(1536)` + IVFFlat index
- `chunk_similarities` — pairwise scores
- `conflicts` — GPT-4o findings with values, contexts, severity
- `analysis_jobs` — batch run progress

## Environment variables

See `.env.example`. The minimum required to boot is `DATABASE_URL`. Cohere, OpenAI, and
SharePoint capabilities are enabled when their respective keys are present.

## Notes

- **Chunking** is heading-aware with ~10% overlap; tune via `CHUNK_TOKEN_SIZE` /
  `CHUNK_OVERLAP_TOKENS`.
- **IVFFlat `lists` = 100** is appropriate for a few hundred to ~10k documents. For larger
  corpora, increase `lists` (≈ √rows) or migrate to HNSW.
- The Cohere embedding model name is centralized in `server/cohere.ts` — swap to
  `embed-v4.0` (or any 1536-dim model) when available.
