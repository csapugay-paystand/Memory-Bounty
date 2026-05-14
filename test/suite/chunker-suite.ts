/**
 * Chunker Test Suite — Layer 1 (local, no network required)
 *
 * Runs the chunker against multi-language fixture files and compares output
 * to the golden JSON definitions. Tests fail until the corresponding sprint
 * task is complete (see "requiresTask" in each golden file entry).
 *
 * Run: npx tsx test/suite/chunker-suite.ts
 * Exit code: 0 = all attempted tests passed, 1 = one or more failures
 */

import { chunkFile } from "../../src/chunker.js";
import { readFile } from "fs/promises";
import { resolve } from "path";
import type { Chunk } from "../../src/types.js";

// --- Types matching the golden JSON schema ---

interface ChunkSpec {
  symbol: string;
  chunk_type: string;
  textMustContain?: string[];
  textMustNotContain?: string[];
}

interface FileSpec {
  file: string;
  language: string;
  requiresTask: string | null;
  expectedChunks: ChunkSpec[];
  notExpected?: string[];
}

// --- Helpers ---

const PASS = "✓";
const FAIL = "✗";
const SKIP = "○";

let totalPassed = 0;
let totalFailed = 0;
let totalSkipped = 0;

function pass(msg: string) {
  console.log(`    ${PASS} ${msg}`);
  totalPassed++;
}

function fail(msg: string) {
  console.error(`    ${FAIL} ${msg}`);
  totalFailed++;
}

function skip(msg: string) {
  console.log(`    ${SKIP} ${msg}`);
  totalSkipped++;
}

function assertChunksMatchGolden(
  chunks: Chunk[],
  spec: FileSpec
): void {
  const extractedSymbols = chunks.map((c) => c.symbol);
  const expectedSymbols = spec.expectedChunks.map((s) => s.symbol);

  // 1. All expected symbols are present
  for (const expected of expectedSymbols) {
    if (extractedSymbols.includes(expected)) {
      pass(`symbol "${expected}" found`);
    } else {
      fail(`symbol "${expected}" NOT found (got: ${extractedSymbols.join(", ")})`);
    }
  }

  // 2. No unexpected symbols (excluding any symbols listed in notExpected which are intentionally excluded)
  const notExpected = spec.notExpected ?? [];
  const unexpected = extractedSymbols.filter(
    (s) => !expectedSymbols.includes(s) && !notExpected.includes(s)
  );
  if (unexpected.length === 0) {
    pass(`no unexpected symbols`);
  } else {
    fail(`unexpected symbols found: ${unexpected.join(", ")}`);
  }

  // 3. Per-chunk assertions (type, hash, text)
  for (const chunkSpec of spec.expectedChunks) {
    const chunk = chunks.find((c) => c.symbol === chunkSpec.symbol);
    if (!chunk) continue; // already reported as missing above

    // Chunk type
    if (chunk.chunk_type === chunkSpec.chunk_type) {
      pass(`"${chunkSpec.symbol}" has correct chunk_type "${chunkSpec.chunk_type}"`);
    } else {
      fail(
        `"${chunkSpec.symbol}" chunk_type is "${chunk.chunk_type}", expected "${chunkSpec.chunk_type}"`
      );
    }

    // Hash is a valid 64-char hex string
    if (/^[0-9a-f]{64}$/.test(chunk.hash)) {
      pass(`"${chunkSpec.symbol}" has valid SHA-256 hash`);
    } else {
      fail(`"${chunkSpec.symbol}" has invalid hash: "${chunk.hash}"`);
    }

    // textMustContain
    for (const term of chunkSpec.textMustContain ?? []) {
      if (chunk.text.includes(term)) {
        pass(`"${chunkSpec.symbol}" text contains "${term}"`);
      } else {
        fail(
          `"${chunkSpec.symbol}" text does NOT contain "${term}" (text preview: ${chunk.text.slice(0, 80).replace(/\n/g, "↵")}...)`
        );
      }
    }

    // textMustNotContain — key assertion for the arrow-function text span fix
    for (const term of chunkSpec.textMustNotContain ?? []) {
      if (!chunk.text.includes(term)) {
        pass(`"${chunkSpec.symbol}" text correctly does NOT contain "${term}"`);
      } else {
        fail(
          `"${chunkSpec.symbol}" text should NOT contain "${term}" (arrow-function text span bug still present)`
        );
      }
    }
  }
}

async function runFileSpec(spec: FileSpec): Promise<void> {
  const filePath = resolve(process.cwd(), spec.file);
  const label = `[${spec.file}] (${spec.language})`;

  if (spec.requiresTask) {
    console.log(`\n${SKIP} ${label}`);
    console.log(`  Blocked on: ${spec.requiresTask}`);
    console.log(`  (attempting anyway — fail = not yet implemented)`);
  } else {
    console.log(`\n▶ ${label}`);
  }

  let chunks: Chunk[];
  try {
    chunks = await chunkFile(filePath);
  } catch (err) {
    if (spec.requiresTask) {
      skip(`chunkFile threw (expected until task is done): ${(err as Error).message}`);
      return;
    }
    fail(`chunkFile threw unexpectedly: ${(err as Error).message}`);
    return;
  }

  console.log(`  → extracted ${chunks.length} chunk(s)`);
  assertChunksMatchGolden(chunks, spec);
}

async function main() {
  console.log("=== Chunker Suite ===\n");
  console.log("Golden files: test/golden/mini-api-chunks.json, test/golden/edge-cases-chunks.json");

  const goldenFiles = [
    "test/golden/mini-api-chunks.json",
    "test/golden/edge-cases-chunks.json",
  ];

  const allSpecs: FileSpec[] = [];
  for (const goldenFile of goldenFiles) {
    const raw = await readFile(resolve(process.cwd(), goldenFile), "utf8");
    const specs = JSON.parse(raw) as FileSpec[];
    allSpecs.push(...specs);
  }

  for (const spec of allSpecs) {
    await runFileSpec(spec);
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
