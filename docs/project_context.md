# Codebase Memory System — Project Context

## What This Project Is

A system that extracts knowledge from a codebase and stores it in a persistent, semantically searchable memory structure so that AI agents working on that codebase can efficiently retrieve relevant context without reading irrelevant code.

The analogy: right now a codebase is a library where books are in random piles on the floor. This system puts every book on a labeled shelf with a card catalog, so any agent can find exactly what it needs instantly.

**This project is purely the write side.** Codebase goes in, memory comes out. How agents query that memory is not in scope — that is handled by whatever agent consumes it.

---

## The Problem Being Solved

When an AI agent needs to understand how something works in a codebase, it either has to blindly read through files or have relevant code manually pasted into its context. That does not scale. This system gives agents a pre-built, structured memory layer they can pull from efficiently.

---

## How It Works (Core Loop)

1. **Chunk** — parse the codebase into clean semantic units (functions, classes, schemas) using AST parsing via Tree-sitter. Never split by line count or file — always at natural code boundaries.
2. **Describe** — an agent reads each chunk and writes a plain English description of what it does, why it matters, and what concepts a developer would search for to find it. This description is the most important output — retrieval quality depends entirely on description quality.
3. **Embed** — Workers AI converts the description into a vector (a list of numbers representing its meaning mathematically).
4. **Store** — the vector, description, metadata, and raw source are stored across Cloudflare-native services.

---

## Storage Architecture


| Service             | Role                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vectorize**       | Stores vectors. Enables semantic (meaning-based) similarity search. The core search index.                                                   |
| **D1**              | SQL database. Stores structured metadata: file paths, symbol names, chunk types, dependency relationships, SHA-256 hashes for deduplication. |
| **R2**              | Object storage. Stores raw source code blobs.                                                                                                |
| **KV**              | Hot cache for frequently accessed chunks.                                                                                                    |
| **Durable Objects** | Coordinate ingestion job state per repo. Handle progress tracking and failure recovery.                                                      |
| **Workers AI**      | Runs the embedding model that converts text to vectors. No external API — runs on Cloudflare.                                                |


---

## What a Single Chunk Looks Like in Storage

```
description:  "Entry point for Stripe webhook processing, validates 
               signatures and routes payment events to handlers"
vector:       [0.23, -0.87, 0.41, ...]
text:         raw source code (stored in R2)
file_path:    src/payments/webhooks.ts
chunk_type:   logic
symbol:       handleWebhookEvent
repo:         payments-service
dependencies: [validateSignature, paymentHandlers, stripe]
hash:         a3f9bc...
```

---

## Keeping Memory Current

- Undecided

## Target Agent Consumers (Future — Not In Scope Now)

The memory system is being built to eventually support:

- Ticket agents
- Product development agents
- Refactor agents
- Architecture agents
- Support agents

These are separate projects. This project only builds the memory they will consume.

---

## Constraints

- **No UI** — CLI only
- **Cloudflare-native memory** — Vectorize, D1, R2, KV, Durable Objects. No markdown files as operational memory.
- **Cost conscious** — favor non-frontier models for bulk work (embedding, description writing). Frontier models only where judgment is critical.
- **Must be reusable** — any team should be able to point this at their own repo and get a working memory layer

---

---

# Base Implementation

## Goal

Prove that all the architectural pieces connect and work together. Not an MVP. The smallest possible thing that exercises every layer.

**One file in. Memory built. Done.**

## What We Are Building

A single CLI command:

```bash
$ ingest ./src/payments/webhooks.ts
→ chunked 4 functions
→ descriptions written
→ stored in Vectorize + D1
✓ done
```

That is the entire base. No git hooks, no incremental updates, no KV, no R2, no Durable Objects, no multi-repo handling, no querying. Those all come later.

## The Four Pieces We Need

### 1. Tree-sitter (chunking)

- Takes a single file as input
- Parses it into an AST
- Extracts clean chunks at function and class boundaries
- Outputs: array of `{ symbol, text, file_path, chunk_type }`

### 2. Description writer (agent)

- Takes each chunk from Tree-sitter
- Sends it to a language model with a prompt asking for a plain English description
- Prompt must instruct: write from the perspective of someone searching, not someone reading
- Outputs: description string per chunk

### 3. Workers AI (embedding)

- Takes each description string
- Runs it through an embedding model on Cloudflare
- Outputs: vector per chunk

### 4. Vectorize + D1 (storage)

- Vectorize: upsert the vector with chunk metadata attached
- D1: insert a row with symbol, file_path, chunk_type, hash, description

## What Success Looks Like

After running the ingest command on a single file:

- Vectorize contains vectors for each function/class in that file
- D1 contains a metadata row for each chunk
- No errors
- The stored descriptions make sense if you read them

## Technology

- **Runtime**: Cloudflare Worker (invoked via CLI using Wrangler)
- **Chunking**: Tree-sitter (local, runs before the Worker)
- **Embedding**: Workers AI (`@cf/baai/bge-small-en-v1.5` or equivalent)
- **Vector store**: Cloudflare Vectorize
- **Metadata store**: Cloudflare D1
- **CLI trigger**: `wrangler` or a local TypeScript script that calls the Worker

## What We Are Explicitly Not Building Yet

- Multi-file or full-repo ingestion
- Incremental re-ingestion / SHA-256 dedup
- Git push hooks
- R2 raw source storage
- KV caching
- Durable Objects job coordination
- Any querying or retrieval interface
- Multi-language support beyond one language to start

