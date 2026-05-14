/**
 * Description Quality Suite — Layer 2 (requires live deployed Worker)
 *
 * Ingests each fixture file against the real Worker and validates that the
 * LLM-generated descriptions meet the quality criteria defined in
 * test/golden/description-criteria.json.
 *
 * Since descriptions are non-deterministic, we do NOT exact-match. Instead
 * we check:
 *   - Minimum character length (description isn't a stub)
 *   - At least one domain keyword is present (description is on-topic)
 *   - Bad opener phrases are absent (LLM isn't narrating instead of describing)
 *
 * Run:
 *   WORKER_URL=https://memory-bounty.<account>.workers.dev \
 *   npx tsx test/suite/description-suite.ts
 *
 * Exit code: 0 = all attempted tests passed, 1 = one or more failures
 */

import { chunkFile } from "../../src/chunker.js";
import { readFile } from "fs/promises";
import { resolve } from "path";
import type { Chunk } from "../../src/types.js";

// --- Types matching golden/description-criteria.json ---

interface ChunkCriteria {
  fixture: string;
  domain: string;
  minLength: number;
  mustContainAny: string[];
}

interface DescriptionCriteria {
  badPhrases: string[];
  chunks: Record<string, ChunkCriteria>;
}

interface WorkerChunkResult {
  symbol: string;
  hash: string;
  description: string;
  ok: boolean;
  error?: string;
}

interface WorkerIngestResponse {
  success: boolean;
  processed: number;
  results: WorkerChunkResult[];
}

// --- Helpers ---

let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;

function pass(msg: string) {
  console.log(`    ✓ ${msg}`);
  totalPassed++;
}

function fail(msg: string) {
  console.error(`    ✗ ${msg}`);
  totalFailed++;
}

function skip(msg: string) {
  console.log(`    ○ ${msg}`);
  totalSkipped++;
}

function checkDescription(
  symbol: string,
  description: string,
  criteria: DescriptionCriteria
): void {
  const chunkCriteria = criteria.chunks[symbol];

  if (!chunkCriteria) {
    skip(`"${symbol}" — no criteria defined, skipping quality check`);
    return;
  }

  // 1. Not empty / not a fallback stub
  if (!description || description.trim().length === 0) {
    fail(`"${symbol}" description is empty`);
    return;
  }

  const lowerDesc = description.toLowerCase();

  // 2. Minimum length
  if (description.length >= chunkCriteria.minLength) {
    pass(`"${symbol}" meets minimum length (${description.length} >= ${chunkCriteria.minLength} chars)`);
  } else {
    fail(
      `"${symbol}" description too short (${description.length} chars, need ${chunkCriteria.minLength}). Description: "${description}"`
    );
  }

  // 3. Must contain at least one domain keyword
  const foundKeyword = chunkCriteria.mustContainAny.find((kw) =>
    lowerDesc.includes(kw.toLowerCase())
  );
  if (foundKeyword) {
    pass(`"${symbol}" contains domain keyword "${foundKeyword}"`);
  } else {
    fail(
      `"${symbol}" contains NONE of the expected keywords: [${chunkCriteria.mustContainAny.join(", ")}]. Description: "${description}"`
    );
  }

  // 4. Does not start with a narration phrase
  const badPhrase = criteria.badPhrases.find((phrase) =>
    description.trimStart().toLowerCase().startsWith(phrase.toLowerCase())
  );
  if (!badPhrase) {
    pass(`"${symbol}" does not start with a bad opener phrase`);
  } else {
    fail(
      `"${symbol}" starts with bad phrase "${badPhrase}" — LLM is narrating, not describing. Full description: "${description}"`
    );
  }
}

async function ingestFileViaWorker(
  filePath: string,
  workerUrl: string
): Promise<WorkerChunkResult[]> {
  let chunks: Chunk[];
  try {
    chunks = await chunkFile(filePath);
  } catch (err) {
    throw new Error(`chunkFile failed for ${filePath}: ${(err as Error).message}`);
  }

  if (chunks.length === 0) {
    return [];
  }

  const response = await fetch(`${workerUrl}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chunks }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Worker returned HTTP ${response.status}: ${text}`);
  }

  const data = (await response.json()) as WorkerIngestResponse;
  return data.results;
}

async function main() {
  const workerUrl = process.env["WORKER_URL"];
  if (!workerUrl) {
    console.error("Error: WORKER_URL environment variable is not set.");
    console.error("Usage: WORKER_URL=https://memory-bounty.<account>.workers.dev npx tsx test/suite/description-suite.ts");
    process.exit(1);
  }

  console.log("=== Description Quality Suite ===\n");
  console.log(`Worker URL: ${workerUrl}`);
  console.log("Criteria: test/golden/description-criteria.json\n");

  const criteriaRaw = await readFile(
    resolve(process.cwd(), "test/golden/description-criteria.json"),
    "utf8"
  );
  const criteria = JSON.parse(criteriaRaw) as DescriptionCriteria;

  // All fixture files to test (TypeScript only until Task 3 adds multi-language)
  const fixtureFiles = [
    "test/fixtures/mini-api/src/auth.ts",
    "test/fixtures/mini-api/src/handlers.ts",
    // Python and Go files added here once Task 3 is complete:
    // "test/fixtures/mini-api/lib/utils.py",
    // "test/fixtures/mini-api/pkg/server.go",
  ];

  for (const filePath of fixtureFiles) {
    const absPath = resolve(process.cwd(), filePath);
    console.log(`\n▶ [${filePath}]`);

    let results: WorkerChunkResult[];
    try {
      results = await ingestFileViaWorker(absPath, workerUrl);
    } catch (err) {
      fail(`Failed to ingest: ${(err as Error).message}`);
      continue;
    }

    console.log(`  → Worker processed ${results.length} chunk(s)`);

    for (const result of results) {
      if (!result.ok) {
        fail(`"${result.symbol}" Worker returned error: ${result.error ?? "unknown"}`);
        continue;
      }
      console.log(`\n  Checking "${result.symbol}":`);
      console.log(`  Description: "${result.description.slice(0, 120)}${result.description.length > 120 ? "..." : ""}"`);
      checkDescription(result.symbol, result.description, criteria);
    }
  }

  console.log("\n" + "=".repeat(40));
  console.log(`Results: ${totalPassed} passed, ${totalFailed} failed, ${totalSkipped} skipped`);

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
