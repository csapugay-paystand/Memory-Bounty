/**
 * Ingest Integration Suite — Layer 3 (requires live Worker + Cloudflare bindings)
 *
 * Tests the full end-to-end pipeline against a real deployed Worker:
 *   1. Worker health check
 *   2. Ingest the mini-api fixture directory and verify all expected symbols are stored
 *   3. Re-ingest the same fixture and verify all chunks are skipped (dedup — Task 4)
 *
 * Run:
 *   WORKER_URL=https://memory-bounty.<account>.workers.dev \
 *   npx tsx test/suite/ingest-integration.ts
 *
 * Exit code: 0 = all tests passed, 1 = one or more failures
 *
 * Note: Task 4 (dedup) must be implemented for Test 3 to pass.
 * Test 3 is attempted regardless and will fail until Task 4 is done.
 */

import { chunkFile } from "../../src/chunker.js";
import { resolve } from "path";
import type { Chunk } from "../../src/types.js";

interface WorkerChunkResult {
  symbol: string;
  hash: string;
  description: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

interface WorkerIngestResponse {
  success: boolean;
  processed: number;
  skipped?: number;
  results: WorkerChunkResult[];
}

// All TypeScript fixture files in mini-api (Python/Go added after Task 3)
const FIXTURE_FILES = [
  "test/fixtures/mini-api/src/auth.ts",
  "test/fixtures/mini-api/src/handlers.ts",
];

// Expected symbol inventory — every one of these must appear in the ingest response
const EXPECTED_SYMBOLS = [
  "hashPassword", "verifyPassword", "generateToken", "validateToken",
  "AuthService", "login", "logout", "refreshToken",
  "handleGetUser", "handleCreateUser", "handleDeleteUser", "applyMiddleware",
];

let totalPassed = 0;
let totalFailed = 0;

function pass(msg: string) {
  console.log(`  ✓ ${msg}`);
  totalPassed++;
}

function fail(msg: string) {
  console.error(`  ✗ ${msg}`);
  totalFailed++;
}

async function collectChunks(files: string[]): Promise<Chunk[]> {
  const all: Chunk[] = [];
  for (const file of files) {
    const abs = resolve(process.cwd(), file);
    const chunks = await chunkFile(abs);
    all.push(...chunks);
  }
  return all;
}

async function postToWorker(
  chunks: Chunk[],
  workerUrl: string
): Promise<WorkerIngestResponse> {
  const response = await fetch(`${workerUrl}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chunks }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Worker returned HTTP ${response.status}: ${text}`);
  }

  return (await response.json()) as WorkerIngestResponse;
}

// --- Test 1: Health check ---
async function testHealthCheck(workerUrl: string): Promise<void> {
  console.log("\n▶ Test 1: Worker health check");
  const response = await fetch(`${workerUrl}/health`);
  if (response.ok) {
    const data = (await response.json()) as { ok: boolean };
    if (data.ok === true) {
      pass("GET /health returned { ok: true }");
    } else {
      fail(`GET /health returned unexpected body: ${JSON.stringify(data)}`);
    }
  } else {
    fail(`GET /health returned HTTP ${response.status}`);
  }
}

// --- Test 2: First ingest — all symbols stored ---
async function testFirstIngest(
  workerUrl: string
): Promise<WorkerChunkResult[]> {
  console.log("\n▶ Test 2: First ingest — all symbols should be processed");

  const chunks = await collectChunks(FIXTURE_FILES);
  console.log(`  → Sending ${chunks.length} chunks to Worker`);

  const data = await postToWorker(chunks, workerUrl);

  if (data.success) {
    pass(`Worker reported success`);
  } else {
    fail(`Worker reported failure`);
  }

  const succeeded = data.results.filter((r) => r.ok && !r.skipped);
  const failed = data.results.filter((r) => !r.ok);

  pass(`${succeeded.length}/${data.processed} chunks processed without error`);

  if (failed.length > 0) {
    for (const r of failed) {
      fail(`"${r.symbol}" failed: ${r.error ?? "unknown error"}`);
    }
  }

  // Check that all expected symbols appear in the response
  const returnedSymbols = data.results.map((r) => r.symbol);
  for (const expected of EXPECTED_SYMBOLS) {
    if (returnedSymbols.includes(expected)) {
      pass(`"${expected}" present in ingest response`);
    } else {
      fail(`"${expected}" missing from ingest response`);
    }
  }

  return data.results;
}

// --- Test 3: Second ingest — all chunks should be skipped (Task 4 — dedup) ---
async function testDeduplication(workerUrl: string): Promise<void> {
  console.log("\n▶ Test 3: Second ingest — all chunks should be skipped (requires Task 4 — dedup)");

  const chunks = await collectChunks(FIXTURE_FILES);
  console.log(`  → Re-sending ${chunks.length} chunks to Worker`);

  const data = await postToWorker(chunks, workerUrl);

  if (data.skipped === undefined) {
    fail(
      `Worker response does not include a "skipped" field — Task 4 (dedup) not yet implemented`
    );
    return;
  }

  const skippedCount = data.results.filter((r) => r.skipped === true).length;
  const processedCount = data.results.filter((r) => r.ok && !r.skipped).length;

  if (skippedCount === chunks.length) {
    pass(`All ${skippedCount} chunks were skipped on re-ingest (dedup working)`);
  } else {
    fail(
      `Expected ${chunks.length} skipped, got ${skippedCount} skipped and ${processedCount} re-processed`
    );
  }
}

async function main() {
  const workerUrl = process.env["WORKER_URL"];
  if (!workerUrl) {
    console.error("Error: WORKER_URL environment variable is not set.");
    console.error(
      "Usage: WORKER_URL=https://memory-bounty.<account>.workers.dev npx tsx test/suite/ingest-integration.ts"
    );
    process.exit(1);
  }

  console.log("=== Ingest Integration Suite ===\n");
  console.log(`Worker URL: ${workerUrl}`);
  console.log(`Fixtures: ${FIXTURE_FILES.join(", ")}`);

  try {
    await testHealthCheck(workerUrl);
    await testFirstIngest(workerUrl);
    await testDeduplication(workerUrl);
  } catch (err) {
    console.error("\nUnexpected error during test run:", err);
    totalFailed++;
  }

  console.log("\n" + "=".repeat(40));
  console.log(`Results: ${totalPassed} passed, ${totalFailed} failed`);

  if (totalFailed > 0) {
    console.error(`\n✗ Suite FAILED (${totalFailed} failure(s))`);
    process.exit(1);
  } else {
    console.log(`\n✓ Suite PASSED`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
