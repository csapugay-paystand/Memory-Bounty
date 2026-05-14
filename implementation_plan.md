# Base Implementation Plan

## Objective

Build the smallest possible end-to-end proof that all architectural pieces connect. One file in, memory out. Every layer exercised once.

```bash
$ ingest ./src/payments/webhooks.ts
→ chunked 4 functions
→ descriptions written
→ stored in Vectorize + D1
✓ done
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Worker |
| Chunking | Tree-sitter (Node.js, runs locally before the Worker) |
| Description writing | LLM via Workers AI or Cloudflare AI Gateway |
| Embedding | Workers AI — `@cf/baai/bge-small-en-v1.5` |
| Vector store | Cloudflare Vectorize |
| Metadata store | Cloudflare D1 |
| CLI | Local TypeScript script (`ingest.ts`) using `tsx` |

**Language to support first:** TypeScript

---

## Project Structure

```
memory-bounty/
├── src/
│   ├── ingest.ts          # CLI entry point
│   ├── chunker.ts         # Tree-sitter parsing logic
│   └── types.ts           # Shared types
├── worker/
│   ├── index.ts           # Cloudflare Worker — receives chunks, runs AI, writes storage
│   └── wrangler.toml      # Worker config (D1, Vectorize, AI bindings)
├── package.json
└── tsconfig.json
```

---

## Step-by-Step Implementation

### Step 1 — Project Setup

- Initialize a Node.js TypeScript project (`package.json`, `tsconfig.json`)
- Install local dependencies:
  - `tree-sitter` + `tree-sitter-typescript`
  - `tsx` (for running TypeScript CLI locally without a build step)
  - `@cloudflare/workers-types` (for Worker type definitions)
  - `wrangler` (for deploying the Worker and running D1 migrations)
- Create the Cloudflare Worker project scaffold (`worker/wrangler.toml`)

---

### Step 2 — Define Shared Types (`src/types.ts`)

Define the single data structure that flows through the entire pipeline:

```typescript
export interface Chunk {
  symbol: string;       // e.g. "handleWebhookEvent"
  text: string;         // raw source code of the chunk
  file_path: string;    // e.g. "src/payments/webhooks.ts"
  chunk_type: "function" | "class" | "method";
  hash: string;         // SHA-256 of text, for future dedup
  description?: string; // filled in by the Worker
}
```

---

### Step 3 — Tree-sitter Chunker (`src/chunker.ts`)

**Goal:** Parse a single TypeScript file into an array of `Chunk` objects.

**Logic:**
1. Accept a file path, read the file contents
2. Initialize `tree-sitter` with `tree-sitter-typescript`
3. Walk the AST and extract nodes at these boundaries:
   - `function_declaration`
   - `arrow_function` (when assigned to a named variable)
   - `class_declaration`
   - `method_definition`
4. For each extracted node, capture:
   - `symbol` — the function/class name
   - `text` — the raw source slice for that node
   - `file_path` — the input file path
   - `chunk_type` — function, class, or method
   - `hash` — `sha256(text)` using Node's built-in `crypto`
5. Return `Chunk[]`

**Edge cases to handle:**
- Anonymous functions (skip them or use variable name if assigned)
- Nested functions (include only top-level + class methods; skip nested)

---

### Step 4 — D1 Schema

Create a migration file and run it via Wrangler before deploying.

```sql
CREATE TABLE IF NOT EXISTS chunks (
  id          TEXT PRIMARY KEY,  -- hash
  symbol      TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  chunk_type  TEXT NOT NULL,
  description TEXT NOT NULL,
  repo        TEXT,
  created_at  INTEGER DEFAULT (unixepoch())
);
```

Run with:
```bash
wrangler d1 execute memory-bounty-db --file=migrations/001_init.sql
```

---

### Step 5 — Cloudflare Worker (`worker/index.ts`)

**Goal:** Accept an array of chunks via HTTP POST, run descriptions + embeddings, and write to Vectorize + D1.

**Bindings required in `wrangler.toml`:**
- `AI` — Workers AI
- `VECTORIZE` — Vectorize index
- `DB` — D1 database

**Request shape:**
```typescript
POST /ingest
Body: { chunks: Chunk[] }
```

**Worker logic (per chunk, sequentially for base impl):**

1. **Write description** — call Workers AI with a chat/completion model:

   ```
   Prompt: You are describing a code chunk so a developer can search for it later.
   Write 2-3 sentences describing: what this code does, why it exists, and what
   concepts or keywords someone would search to find it. Do not narrate the code
   line by line. Write from the perspective of a searcher, not a reader.

   Code:
   <chunk.text>
   ```

   Model: `@cf/meta/llama-3-8b-instruct` (cost-conscious, non-frontier)

2. **Embed description** — call Workers AI embedding:
   ```typescript
   const { data } = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
     text: [description]
   });
   const vector = data[0];
   ```

3. **Upsert to Vectorize:**
   ```typescript
   await env.VECTORIZE.upsert([{
     id: chunk.hash,
     values: vector,
     metadata: {
       symbol: chunk.symbol,
       file_path: chunk.file_path,
       chunk_type: chunk.chunk_type,
       description,
     }
   }]);
   ```

4. **Insert to D1:**
   ```typescript
   await env.DB.prepare(
     `INSERT OR REPLACE INTO chunks (id, symbol, file_path, chunk_type, description)
      VALUES (?, ?, ?, ?, ?)`
   ).bind(chunk.hash, chunk.symbol, chunk.file_path, chunk.chunk_type, description)
    .run();
   ```

5. **Return** a JSON summary of what was stored.

---

### Step 6 — CLI Entry Point (`src/ingest.ts`)

**Goal:** Accept a file path argument, chunk it locally, POST the chunks to the Worker.

**Logic:**
1. Read `process.argv[2]` as the file path; error if missing
2. Call `chunker.ts` to get `Chunk[]`
3. Print `→ chunked N functions/classes`
4. POST `{ chunks }` to the Worker URL (configurable via env var `WORKER_URL`)
5. Print `→ descriptions written` and `→ stored in Vectorize + D1` based on response
6. Print `✓ done`

**Run locally with:**
```bash
WORKER_URL=https://memory-bounty.<account>.workers.dev npx tsx src/ingest.ts ./path/to/file.ts
```

---

### Step 7 — `wrangler.toml` Configuration

```toml
name = "memory-bounty"
main = "worker/index.ts"
compatibility_date = "2024-01-01"

[ai]
binding = "AI"

[[vectorize]]
binding = "VECTORIZE"
index_name = "memory-bounty-index"

[[d1_databases]]
binding = "DB"
database_name = "memory-bounty-db"
database_id = "<your-d1-id>"
```

---

### Step 8 — Vectorize Index Setup

Create the index before deploying:

```bash
wrangler vectorize create memory-bounty-index \
  --dimensions=384 \
  --metric=cosine
```

`384` matches the output dimensions of `@cf/baai/bge-small-en-v1.5`.

---

## Build Order

Execute these in sequence — each step depends on the previous:

1. Project setup and dependency install
2. Define `types.ts`
3. Build and test `chunker.ts` against a sample file (log output to verify chunks)
4. Create D1 database and run migration
5. Create Vectorize index
6. Build and deploy `worker/index.ts`
7. Test Worker in isolation with a hardcoded single chunk via `curl`
8. Build `ingest.ts` CLI
9. Run end-to-end: `ingest ./sample.ts` and verify D1 rows + Vectorize vectors exist

---

## Verification / Success Criteria

After running `ingest` on a single file:

- [ ] CLI prints correct chunk count
- [ ] No errors thrown
- [ ] D1 query returns one row per function/class in the file
- [ ] Vectorize returns vectors when queried by ID
- [ ] Reading the stored descriptions makes sense in plain English

```bash
# Spot-check D1
wrangler d1 execute memory-bounty-db --command="SELECT symbol, description FROM chunks"

# Spot-check Vectorize (query by known ID)
wrangler vectorize query memory-bounty-index --vector-id=<hash>
```

---

## What Is Explicitly Out of Scope

- Multi-file or full-repo ingestion
- Incremental re-ingestion / dedup (hash column exists but is unused)
- R2 raw source storage
- KV caching
- Durable Objects job coordination
- Any query/retrieval interface
- Git hooks
- Multi-language support beyond TypeScript
