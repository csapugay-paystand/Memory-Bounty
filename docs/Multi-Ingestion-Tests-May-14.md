# Multi-Ingestion Tests — May 14, 2026

> Running log of test suite results as Sprint 2A is implemented.
> Re-run all three suites after each task completes and append results below.

---

## Test Environment

| | |
|---|---|
| Date | May 14, 2026 |
| Worker | `wrangler dev --remote` on `http://localhost:8788` |
| Worker build | Phase 1 complete — no Sprint 2A tasks implemented yet |
| Cloudflare bindings | AI (`llama-3.1-8b-instruct`), Vectorize (`memory-bounty-index`), D1 (`memory-bounty-db`) |

---

## Run 1 — Baseline (before Sprint 2A)

### Layer 1 — Chunker Suite

**Command:** `npx tsx test/suite/chunker-suite.ts`
**Result: 89 passed, 20 failed, 0 skipped**

| File | Language | Outcome | Notes |
|---|---|---|---|
| `mini-api/src/auth.ts` | TypeScript | ✓ All 8 chunks pass | Fully correct |
| `mini-api/src/handlers.ts` | TypeScript | ✓ All 4 chunks pass | Fully correct |
| `mini-api/lib/utils.py` | Python | ✗ 7 failures | Blocked: Task 3 (multi-language) |
| `mini-api/pkg/server.go` | Go | ✗ 4 failures | Blocked: Task 3 (multi-language) |
| `edge-cases/arrows.ts` | TypeScript | ✗ 4 failures | Blocked: Task 1 (arrow text span fix) |
| `edge-cases/class-methods.py` | Python | ✗ 5 failures | Blocked: Task 3 (multi-language) |

**Arrow-function bug confirmed:** All 4 `textMustNotContain` assertions fail. `chunk.text` for arrow functions still includes the leading `const <symbol> =` declaration.

---

### Layer 2 — Description Quality Suite

**Command:** `WORKER_URL=http://localhost:8788 npx tsx test/suite/description-suite.ts`
**Result: 25 passed, 11 failed, 0 skipped**

| Check | Result |
|---|---|
| Minimum length (all symbols) | ✓ All pass — descriptions are substantive (200–430 chars) |
| Domain keywords present (all symbols) | ✓ All pass — descriptions are on-topic |
| No bad opener phrases | ✗ 11/12 fail |

**Root cause of 11 failures:** `llama-3.1-8b-instruct` opens virtually every description with `"This code"`, which is in the `badPhrases` blocklist. The descriptions are otherwise correct and useful — they contain the right domain keywords and are long enough. Only the opener phrasing is wrong.

**The one passing description (logout):**
> *"I'm looking for code that handles user session management, specifically the removal of active sessions when a user logs out..."*

This happens to pass only because the LLM started with "I'm looking for..." instead.

**Action required (prompt engineering):** The description prompt in `worker/index.ts` needs a stronger instruction against narration openers. Suggested addition to the existing prompt:

> *"Do NOT begin with 'This code', 'This function', 'The function', or any similar phrase. Start directly with what a developer would find useful — the concept, the domain, or the action."*

This is a prompt fix, not a model swap — the model is producing good content with a bad first word.

---

### Layer 3 — Ingest Integration Suite

**Command:** `WORKER_URL=http://localhost:8788 npx tsx test/suite/ingest-integration.ts`
**Result: 15 passed, 1 failed**

| Test | Result | Notes |
|---|---|---|
| Worker health check (`GET /health`) | ✓ Pass | Returns `{ ok: true }` |
| All 12 expected symbols stored | ✓ Pass | All symbols present in ingest response |
| All 12 chunks processed without error | ✓ Pass | 12/12 success |
| Re-ingest skips duplicates (dedup) | ✗ Fail | Blocked: Task 4 (SHA-256 dedup) — `skipped` field absent from response |

The pipeline is fully functional end-to-end. The one failure is a clean expected failure — the dedup response field doesn't exist yet because Task 4 isn't implemented.

---

## Why Layers 2 and 3 Initially Errored

First run of Layers 2 and 3 hit `http://localhost:8787` (the `WORKER_URL` in `.env`) but the `wrangler dev --remote` session had restarted and bound to **port 8788** instead. Port 8787 still had a stale `workerd` process returning 405 on `/health` and 404 on `/ingest`. Re-running against the correct port resolved both errors immediately.

**Fix for future runs:** Update `.env` to `WORKER_URL=http://localhost:8788` or match the port wrangler dev actually reports at startup.

---

## Sprint 2A Task Completion Tracker

| Task | Tests It Unblocks | Status |
|---|---|---|
| Task 1 — Fix arrow-function text span | 4 Layer 1 failures in `arrows.ts` | ⬜ Not started |
| Task 2 — Populate `repo` field | No test yet (to be added) | ⬜ Not started |
| Task 3 — Multi-language chunker | 16 Layer 1 failures (Python + Go) | ⬜ Not started |
| Task 4 — SHA-256 deduplication | 1 Layer 3 failure | ⬜ Not started |
| Task 5 — Multi-file directory ingestion | New Layer 3 test needed | ⬜ Not started |
| Task 6 — R2 raw source storage | New Layer 3 test needed | ⬜ Not started |
| Prompt fix — bad opener phrases | 11 Layer 2 failures | ⬜ Not started |

---

## Target: All Green

```
Layer 1: 109 passed, 0 failed
Layer 2:  36 passed, 0 failed   (expands when Python/Go fixtures uncommented)
Layer 3:  16 passed, 0 failed   (expands when dedup + R2 tests added)
```

---

*Append a new "Run N" section below each time tests are re-run.*
