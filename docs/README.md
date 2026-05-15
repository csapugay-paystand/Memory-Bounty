# Memory Bounty

Codebase memory ingestion system. Parses a source file into semantic chunks, writes descriptions, embeds them, and stores in Cloudflare Vectorize + D1.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create Cloudflare resources

```bash
# Create D1 database
wrangler d1 create memory-bounty-db

# Run the migration (replace <DB_ID> with the ID from the command above)
wrangler d1 execute memory-bounty-db --file=migrations/001_init.sql

# Create Vectorize index (384 dimensions, cosine similarity)
wrangler vectorize create memory-bounty-index --dimensions=384 --metric=cosine
```

### 3. Update wrangler.toml

Paste the D1 `database_id` from step 2 into `worker/wrangler.toml`.

### 4. Deploy the Worker

```bash
cd worker && wrangler deploy
```

### 5. Ingest a file

```bash
WORKER_URL=https://memory-bounty.<your-account>.workers.dev npx tsx src/ingest.ts ./path/to/file.ts
```

### 6. Install git hooks (optional)

Auto-ingest changed source files on every commit:

```bash
npm run install-hooks
```

This symlinks `scripts/post-commit` into `.git/hooks/`. The hook reads `WORKER_URL` from your `.env` and runs ingest in the background after each commit — your terminal returns immediately. Output is appended to `.memory-bounty.log` (gitignored).

## What it does

1. Parses the target file with Tree-sitter into function/class chunks
2. Sends chunks to a Cloudflare Worker
3. Worker writes a plain-English description per chunk (Workers AI)
4. Worker embeds each description (Workers AI — bge-small-en-v1.5)
5. Stores vector in Vectorize, metadata in D1
