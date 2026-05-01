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

## Quick start

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
