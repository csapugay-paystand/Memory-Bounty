# Sprint 2A — Test Plan

## Philosophy

Tests are written **before** implementation. Each test suite is designed to fail on the current codebase and pass once the corresponding sprint task is complete. This gives you a clear, runnable definition of "done" for each task.

Descriptions are LLM-generated and non-deterministic, so we never exact-match them. Instead, we define quality criteria: minimum length, required domain keywords, and bad-opener phrases to avoid. If the criteria pass, the description is good enough to power semantic search.

---

## Test Structure

```
test/
  fixtures/
    mini-api/              ← realistic multi-language API service
      src/auth.ts          ← TypeScript: 4 functions + 1 class (3 methods)
      src/handlers.ts      ← TypeScript: 3 arrow functions + 1 regular function
      lib/utils.py         ← Python: 3 functions + 1 class (3 methods)
      pkg/server.go        ← Go: 2 functions + 2 methods on Server struct
    edge-cases/
      arrows.ts            ← TypeScript: 4 arrow functions (tests Task 1 text span fix)
      class-methods.py     ← Python: 1 top-level function + 1 class (3 methods)

  golden/
    mini-api-chunks.json        ← expected symbols, chunk types, text assertions per file
    edge-cases-chunks.json      ← edge-case assertions (arrow fix, Python class/method split)
    description-criteria.json   ← keyword + quality criteria per symbol for description checks

  suite/
    chunker-suite.ts        ← Layer 1: pure chunker tests, no network
    description-suite.ts    ← Layer 2: description quality, requires live Worker
    ingest-integration.ts   ← Layer 3: full pipeline, requires live Worker + Cloudflare
```

---

## The Three Test Layers

### Layer 1 — Chunker Suite (local, no network)

**Run:** `npx tsx test/suite/chunker-suite.ts`

**What it tests:**
- Correct symbols are extracted from each fixture file
- No unexpected symbols are extracted
- Each symbol has the correct `chunk_type` (function / class / method)
- Each chunk has a valid 64-character SHA-256 hash
- `chunk.text` contains expected source terms (`textMustContain`)
- `chunk.text` does NOT contain forbidden terms (`textMustNotContain`) — this is the arrow-function fix assertion

**What it does NOT test:** description quality, embedding, storage

**Which tasks it validates:**
| Test | Passes after |
|---|---|
| TypeScript fixture symbols | Already passes (Phase 1 complete) |
| Arrow text span (`textMustNotContain`) | Task 1 — Fix arrow-function text span |
| Python fixture symbols | Task 3 — Multi-language chunker |
| Go fixture symbols | Task 3 — Multi-language chunker |

**Expected output before any Sprint 2A work:**
```
▶ [test/fixtures/mini-api/src/auth.ts] (typescript)   ← should pass
○ [test/fixtures/edge-cases/arrows.ts] (typescript)    ← fails: textMustNotContain
○ [test/fixtures/mini-api/lib/utils.py] (python)       ← fails: unsupported language
○ [test/fixtures/mini-api/pkg/server.go] (go)          ← fails: unsupported language
```

**Expected output after all Sprint 2A work:**
```
All ✓
```

---

### Layer 2 — Description Quality Suite (requires live Worker)

**Run:**
```bash
WORKER_URL=https://memory-bounty.<account>.workers.dev \
npx tsx test/suite/description-suite.ts
```

**What it tests:**
- Each chunk's description meets the quality bar defined in `test/golden/description-criteria.json`
- Minimum description length (rejects stub/fallback outputs)
- At least one domain keyword is present (rejects off-topic descriptions)
- Description does not start with a narration phrase like "This function..." (rejects LLM narration anti-pattern)

**What it does NOT test:** storage in Vectorize/D1, dedup, R2

**Which tasks it validates:**
| Test | Passes after |
|---|---|
| TypeScript fixture descriptions | Worker deployed (already available) |
| Python + Go fixture descriptions | Task 3 — Multi-language chunker (file the comment out in the suite) |

**How to interpret failures:**
- `too short` → LLM returned a fallback stub; check model/prompt
- `contains NONE of expected keywords` → description is off-topic; improve the description prompt
- `starts with bad phrase` → LLM is narrating the code, not describing for search; the prompt instruction needs reinforcement

---

### Layer 3 — Ingest Integration Suite (requires live Worker + Cloudflare)

**Run:**
```bash
WORKER_URL=https://memory-bounty.<account>.workers.dev \
npx tsx test/suite/ingest-integration.ts
```

**What it tests:**
1. `GET /health` returns `{ ok: true }`
2. Ingest of all TypeScript mini-api fixtures succeeds; all expected symbols appear in the response
3. Re-ingest of the same fixtures returns a `skipped` count equal to the total chunks (dedup working)

**Which tasks it validates:**
| Test | Passes after |
|---|---|
| Health check | Already passes |
| All symbols in ingest response | Already passes (Phase 1 complete) |
| Dedup / skipped count | Task 4 — SHA-256 deduplication |

---

## Golden File Schema Reference

### `mini-api-chunks.json` / `edge-cases-chunks.json`

```jsonc
[
  {
    "file": "test/fixtures/mini-api/src/auth.ts",
    "language": "typescript",
    "requiresTask": null,                // null = testable now; string = blocked on named task
    "expectedChunks": [
      {
        "symbol": "hashPassword",
        "chunk_type": "function",
        "textMustContain": ["createHmac", "salt"],  // words that must appear in chunk.text
        "textMustNotContain": ["const hashPassword"] // words that must NOT appear (used for arrow fix)
      }
    ],
    "notExpected": ["__init__"]          // symbols expected to be excluded from output
  }
]
```

### `description-criteria.json`

```jsonc
{
  "badPhrases": ["This function", "The function", ...],  // global bad openers
  "chunks": {
    "hashPassword": {
      "fixture": "mini-api/src/auth.ts",
      "domain": "password security, hashing",  // human reference for what this is about
      "minLength": 60,                          // description must be at least this many chars
      "mustContainAny": ["password", "hash", "salt", ...]  // at least one must appear
    }
  }
}
```

---

## Adding New Fixtures

When adding a new language or fixture file in the future:

1. Add the source file to `test/fixtures/<fixture-name>/`
2. Add a new entry in the appropriate golden chunks JSON file with the expected symbols and text assertions
3. Add description criteria for each new symbol in `description-criteria.json`
4. If the file requires a new task to support (e.g., a new language), set `requiresTask` in the golden entry
5. For Python/Go files, uncomment the corresponding entries in `description-suite.ts` once Task 3 is done

---

## Running All Suites

```bash
# Layer 1 (local, fast, run this on every change)
npx tsx test/suite/chunker-suite.ts

# Layer 2 (description quality, run after Worker changes)
WORKER_URL=https://... npx tsx test/suite/description-suite.ts

# Layer 3 (full pipeline, run before declaring a task done)
WORKER_URL=https://... npx tsx test/suite/ingest-integration.ts
```

A sprint task is considered **complete** when all three layers pass for the test cases it owns.
