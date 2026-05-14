# Sprint 2A — Make Ingest Real

## Sprint Goal

Run one command against a real multi-language, multi-file repo. Get clean, deduplicated, fully-stored memory in Cloudflare. No manual cleanup needed.

```bash
npx ingest ./src --repo payments-api
→ found 12 files (TypeScript, Python, Go)
→ chunked 94 symbols (11 skipped, already stored)
→ described + embedded + stored 83 chunks
✓ done in 28s
```

This sprint completes the write side of the pipeline and makes Act 1 of the demo credible on any real repo.

---

## Context

Phase 1 proved the pipeline works end-to-end on a single TypeScript file. Phase 2A makes it production-ready for demo use:

- Single file → **entire repo (multi-file, multi-language)**
- Re-ingest corrupts data → **re-ingest is safe and idempotent**
- Source code not stored → **raw source in R2 for agent retrieval**
- TypeScript only → **TypeScript, JavaScript, Python, Go**

After this sprint, Phase 2B (query/retrieval route + agent wiring) can be built on top of a stable, complete write side.

---

## Tasks

### Task 1 — Fix Arrow-function Text Span

**File:** `src/chunker.ts`
**Effort:** Small
**Why first:** Correctness before scale. Bad chunk text → bad descriptions → bad retrieval at scale.

**Problem:** Arrow-function chunks currently capture the full `const x = () => ...` `lexical_declaration` node as their `text`. The `text` should be just the arrow function body, not the entire variable declaration.

**What to do:**
- In `buildChunk`, when the node is a `lexical_declaration` wrapping an arrow function, walk down to the arrow function node itself and use that as the span for `text`
- The `symbol` (variable name) should still come from the `lexical_declaration`
- Verify with the existing chunker test fixtures

---

### Task 2 — Populate `repo` Field

**Files:** `src/ingest.ts`, `worker/index.ts`
**Effort:** Small
**Why before multi-file:** Needs to flow through the entire data model. Cheaper to add now than retrofit after multi-file is in place.

**What to do:**
- Add a `--repo <name>` CLI flag to `src/ingest.ts` (required or optional with a fallback to the directory name)
- Include `repo` in the POST body sent to the Worker
- Update the `IngestRequest` interface in `worker/index.ts` to accept `repo`
- Thread `repo` through to the D1 `INSERT` statement
- Update Vectorize metadata to include `repo` as well

---

### Task 3 — Multi-language Chunker

**Files:** `src/chunker.ts`, `package.json`
**Effort:** Medium
**Why before multi-file:** Once directory walking is in place, non-TypeScript files will be encountered immediately. Language routing must be working first.

**What to do:**

#### 3a — Install grammars
Add the following packages:
- `tree-sitter-javascript` (covers `.js`, `.jsx`)
- `tree-sitter-python` (covers `.py`)
- `tree-sitter-go` (covers `.go`)

TypeScript (`tree-sitter-typescript`) is already installed.

#### 3b — Language detection
Create a helper that maps file extension to language config:

```
.ts / .tsx  → TypeScript parser,  typescript grammar
.js / .jsx  → JavaScript parser,  javascript grammar
.py         → Python parser,      python grammar
.go         → Go parser,          go grammar
(other)     → unsupported, skip with warning
```

#### 3c — AST node mapping per language
Each Tree-sitter grammar uses different node type names. Map them to the common `ChunkType`:

| ChunkType  | TypeScript                  | JavaScript                  | Python               | Go                                     |
|------------|-----------------------------|-----------------------------|----------------------|----------------------------------------|
| `function` | `function_declaration`      | `function_declaration`      | `function_definition`| `function_declaration`                 |
| `class`    | `class_declaration`         | `class_declaration`         | `class_definition`   | `type_declaration` (struct/interface)  |
| `method`   | `method_definition`         | `method_definition`         | `function_definition` (inside class body) | `method_declaration`      |

For named arrow functions (`const foo = () => {}`), this pattern exists in TypeScript and JavaScript only.

#### 3d — Graceful fallback
If a file extension is not in the supported list, skip the file and log:
```
→ skipping unsupported file type: src/legacy/old.rb
```
Do not throw — allow the rest of the directory walk to continue.

---

### Task 4 — SHA-256 Deduplication

**File:** `worker/index.ts`
**Effort:** Small-Medium
**Why before multi-file:** Without dedup, every re-run of ingest creates duplicate Vectorize vectors and D1 rows. Fix this before multi-file ingest can create large volumes of records.

**What to do:**
- At the top of `processChunk`, query D1: `SELECT id FROM chunks WHERE id = ?`
- If a row exists, return early with `{ symbol, hash, description: "", ok: true, skipped: true }`
- Add `skipped` to the `ChunkResult` interface
- In the `IngestResponse`, add a `skipped` count alongside `processed`
- The CLI should print `→ N skipped, already stored` in its output

---

### Task 5 — Multi-file / Directory Ingestion

**File:** `src/ingest.ts`
**Effort:** Medium
**Depends on:** Tasks 1, 2, 3, 4

**What to do:**
- Accept a file path **or** a directory path as the CLI argument
- If a directory is given, recursively walk it and collect all files with supported extensions (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`)
- Optionally support a glob pattern (e.g. `./src/**/*.ts`) via a library like `fast-glob`
- Chunk each file independently
- Batch chunk POST requests — do not send one HTTP request per file; batch into groups of N chunks (e.g. 50) per request to avoid overwhelming the Worker or hitting request size limits
- Print per-file progress:
  ```
  → chunking src/payments/processor.ts (12 symbols)
  → chunking src/payments/retry.ts (4 symbols)
  ...
  ```
- Print final summary:
  ```
  → 42 files processed, 187 chunks stored, 11 skipped
  ✓ done in 43s
  ```

**Note on Worker timeout:** The Worker currently processes chunks sequentially with a `llama-3.1-8b-instruct` call per chunk (~1-5s each). A batch of 50 chunks could take 50-250s, which exceeds the Worker's default 30s CPU time limit. Consider one of:
- Process in smaller batches (10-15 chunks per request)
- Switch to a faster/lighter model for descriptions (see Model Benchmarking note below)

---

### Task 6 — R2 Raw Source Storage

**Files:** `worker/index.ts`, `worker/wrangler.toml`, `migrations/`
**Effort:** Medium
**Why this sprint:** R2 completes the storage architecture from `project_context.md`. The Phase 2B query route needs to return actual source code to agents, not just metadata. Without R2, agents get descriptions and file paths but no source.

**What to do:**

#### 6a — Add R2 binding
In `worker/wrangler.toml`, add an R2 bucket binding:
```toml
[[r2_buckets]]
binding = "CHUNKS_BUCKET"
bucket_name = "memory-bounty-chunks"
```

Create the bucket via Wrangler CLI before deploying:
```bash
wrangler r2 bucket create memory-bounty-chunks
```

#### 6b — Update Worker env interface
Add `CHUNKS_BUCKET: R2Bucket` to the `Env` interface in `worker/index.ts`.

#### 6c — Store source in R2
In `processChunk`, after generating the description, write the raw source to R2:
```
key: chunks/<hash>
body: chunk.text (plain text)
metadata: { symbol, file_path, chunk_type }
```

#### 6d — Store R2 key in D1
Add a `source_key` column to the D1 schema via a new migration file `migrations/002_add_source_key.sql`:
```sql
ALTER TABLE chunks ADD COLUMN source_key TEXT;
```

Update the Worker's D1 insert to populate `source_key` with the R2 object key.

---

## Running the Tests

Tests are written ahead of implementation. Run them after each task to see failures convert to passes. Full test strategy is in `docs/test-plan.md`. Results are logged in `docs/Multi-Ingestion-Tests-May-14.md`.

### Prerequisites

1. The Worker must be running locally with remote bindings:
   ```bash
   cd worker && wrangler dev --remote
   ```
   Note the port it reports at startup — it is usually `8787` but may increment (e.g. `8788`) if a stale process holds the port. Use that port for `WORKER_URL` below.

2. Set `WORKER_URL` in your shell or in `.env`:
   ```bash
   export WORKER_URL=http://localhost:8787
   ```

### Layer 1 — Chunker (local, no Worker needed)

```bash
npx tsx test/suite/chunker-suite.ts
```

Run this after every code change to `src/chunker.ts`. No network required, completes in ~2 seconds.

**What should pass immediately (before any sprint work):**
- All TypeScript mini-api fixtures (`auth.ts`, `handlers.ts`)

**What unblocks as tasks complete:**

| Task | Tests unblocked |
|---|---|
| Task 1 — Fix arrow-function text span | 4 failures in `edge-cases/arrows.ts` |
| Task 3 — Multi-language chunker | 16 failures across Python + Go fixture files |

### Layer 2 — Description Quality (requires live Worker)

```bash
WORKER_URL=http://localhost:8787 npx tsx test/suite/description-suite.ts
```

Run this after changes to the description prompt in `worker/index.ts` or after switching models. Each run takes ~15–20 seconds (one LLM call per chunk).

**Known failure from baseline run (May 14):** `llama-3.1-8b-instruct` opens nearly every description with `"This code..."`, which is in the `badPhrases` blocklist. Length and domain keyword checks all pass. Fix is a prompt instruction in `worker/index.ts` — see the prompt engineering note below.

**What should pass after the prompt fix:**
- All 12 bad-opener failures convert to passes

**Uncomment Python/Go fixture files in `description-suite.ts` once Task 3 is done.**

### Layer 3 — Full Integration (requires live Worker)

```bash
WORKER_URL=http://localhost:8787 npx tsx test/suite/ingest-integration.ts
```

Run this before declaring any task done. Takes ~30–40 seconds.

**What should pass immediately:**
- Health check, all 12 symbols stored, 12/12 processed without error

**What unblocks as tasks complete:**

| Task | Tests unblocked |
|---|---|
| Task 4 — SHA-256 deduplication | 1 failure: re-ingest `skipped` count |

### Logging Results

After each test run, append a new "Run N" section to `docs/Multi-Ingestion-Tests-May-14.md` with the date, which tasks were completed, and the new pass/fail counts.

---

## Prompt Engineering Note

Layer 2 baseline (May 14) revealed that `llama-3.1-8b-instruct` defaults to narration openers. Add the following sentence to the end of the `descriptionPrompt` function in `worker/index.ts`:

> *"Do NOT begin your response with 'This code', 'This function', 'The function', 'This class', or any similar phrase. Start directly with the concept, domain, or action."*

This is a prompt fix — the model's content quality is fine, only the opener is wrong.

---

## Success Criteria

- [ ] Running `ingest` on a mixed TypeScript/Python/Go directory produces clean chunks for all supported file types
- [ ] Re-running `ingest` on the same directory skips all previously stored chunks — no duplicates in Vectorize or D1
- [ ] Each D1 row has a populated `repo` field and a `source_key` pointing to R2
- [ ] Each R2 object contains the raw source text for its chunk, retrievable by hash
- [ ] Arrow-function chunks contain only the function body text, not the full `const` declaration
- [ ] Unsupported file types are skipped with a warning, not an error
- [ ] A real repo (100+ files, mixed languages) ingests without Worker timeout errors
- [ ] Layer 1 suite: 109 passed, 0 failed
- [ ] Layer 2 suite: 36 passed, 0 failed (after Python/Go fixtures uncommented)
- [ ] Layer 3 suite: 16 passed, 0 failed (after dedup + R2 tests added)

---

## Out of Scope for This Sprint

- Query / retrieval route (`POST /query`) — Phase 2B
- KV caching — premature until there is real query load to measure
- Durable Objects job coordination — only needed when tracking job state across failures at scale
- Git hook integration — not needed for the demo
- Languages beyond TypeScript, JavaScript, Python, Go

---

## Model Benchmarking Note

The current description model (`llama-3.1-8b-instruct`) is the biggest latency bottleneck at ~1-5s per chunk. If Worker timeout becomes a real problem during Task 5 testing, run a quick informal comparison of:

- `@cf/meta/llama-3.2-3b-instruct` — smaller, faster
- `@cf/meta/llama-3.1-8b-instruct` — current
- `@cf/meta/llama-3.3-70b-instruct-fp8-fast` — higher quality, more latency

Evaluate on 10 representative chunks. Score on description usefulness for semantic search, not raw text quality. Pick the best latency/quality tradeoff before scaling to full repo ingest.

---

## Files Touched in This Sprint

| File | Change |
|---|---|
| `src/chunker.ts` | Fix arrow-function span; add multi-language support |
| `src/ingest.ts` | Add `--repo` flag; add directory/glob walking; add batching |
| `src/types.ts` | Possibly extend `Chunk` to carry `repo` |
| `worker/index.ts` | Add dedup check; add R2 write; accept `repo` in request; add `skipped` to response |
| `worker/wrangler.toml` | Add R2 bucket binding |
| `migrations/002_add_source_key.sql` | Add `source_key` column to D1 |
| `package.json` | Add `tree-sitter-javascript`, `tree-sitter-python`, `tree-sitter-go` |
| `docs/STATUS.md` | Update after sprint completes |
