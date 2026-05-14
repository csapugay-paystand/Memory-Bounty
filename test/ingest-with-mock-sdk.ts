/**
 * Thin harness used by test-ingest-local.ts.
 * Monkey-patches @cursor/sdk's Agent.prompt with a synchronous stub so the
 * full ingest.ts logic runs end-to-end without a real Cursor API key.
 */
import type { Chunk } from "../src/types.js";

// Stub before importing ingest logic
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sdk = require("@cursor/sdk");
sdk.Agent.prompt = async (prompt: string): Promise<{ status: string; result: string }> => {
  // Extract symbol name from the prompt for a realistic-looking stub description
  const symbolMatch = /Symbol: (\w+)/.exec(prompt);
  const symbol = symbolMatch?.[1] ?? "unknown";
  return {
    status: "finished",
    result: `Stub description for ${symbol}: handles core logic and exposes it for consumption by callers.`,
  };
};

// Now import and run the real ingest logic
import { chunkFile } from "../src/chunker.js";

const { Agent, CursorAgentError } = sdk as typeof import("@cursor/sdk");

const DESCRIPTION_PROMPT = (chunk: Chunk) =>
  `You are building a searchable memory layer for a codebase. Write 2-3 sentences describing the following code chunk so a developer can find it through semantic search. Focus on: what this code does, why it exists, and what concepts or keywords someone would search to find it. Write from the perspective of a searcher, not a reader. Do not narrate line by line. Respond with only the description — no preamble, no code fences.

Symbol: ${chunk.symbol} (${chunk.chunk_type})
File: ${chunk.file_path}

Code:
${chunk.text}`;

async function writeDescription(chunk: Chunk, apiKey: string): Promise<string> {
  try {
    const result = await Agent.prompt(DESCRIPTION_PROMPT(chunk), {
      apiKey,
      model: { id: "composer-2" },
      local: { cwd: process.cwd() },
    });

    if (result.status !== "finished" || !result.result?.trim()) {
      return `${chunk.chunk_type} ${chunk.symbol} in ${chunk.file_path}`;
    }
    return result.result.trim();
  } catch (err) {
    if (err instanceof CursorAgentError) {
      throw new Error(`Cursor SDK error: ${err.message}`);
    }
    throw err;
  }
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) { console.error("Usage: ingest <file>"); process.exit(1); }

  const workerUrl = process.env["WORKER_URL"];
  if (!workerUrl) { console.error("Error: WORKER_URL not set"); process.exit(1); }

  const cursorApiKey = process.env["CURSOR_API_KEY"];
  if (!cursorApiKey) { console.error("Error: CURSOR_API_KEY not set"); process.exit(1); }

  const chunks = await chunkFile(filePath);
  if (chunks.length === 0) { console.log("→ No chunks found."); process.exit(0); }

  const typeBreakdown = chunks.reduce<Record<string, number>>((acc, c) => {
    acc[c.chunk_type] = (acc[c.chunk_type] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = Object.entries(typeBreakdown)
    .map(([type, count]) => `${count} ${type}${count !== 1 ? "s" : ""}`)
    .join(", ");

  console.log(`→ chunked ${chunks.length} symbols (${breakdown})`);
  console.log(`→ writing descriptions via Cursor SDK...`);

  const enrichedChunks: Chunk[] = [];
  for (const chunk of chunks) {
    process.stdout.write(`  ${chunk.symbol.padEnd(30)}`);
    try {
      const description = await writeDescription(chunk, cursorApiKey);
      enrichedChunks.push({ ...chunk, description });
      process.stdout.write(`✓\n`);
    } catch (err) {
      process.stdout.write(`✗\n`);
      enrichedChunks.push({ ...chunk, description: `${chunk.chunk_type} ${chunk.symbol}` });
    }
  }

  console.log(`→ descriptions written`);

  const response = await fetch(`${workerUrl}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chunks: enrichedChunks }),
  });

  if (!response.ok) {
    console.error(`Worker returned HTTP ${response.status}`);
    process.exit(1);
  }

  const data = await response.json() as { success: boolean; processed: number; results: Array<{ ok: boolean; symbol: string; hash: string }> };
  const succeeded = data.results.filter((r) => r.ok);
  const failed = data.results.filter((r) => !r.ok);

  console.log(`→ stored in Vectorize + D1 (${succeeded.length}/${data.processed} chunks)`);

  if (failed.length > 0) {
    console.warn(`⚠ ${failed.length} chunk(s) failed`);
  }

  console.log("\nStored chunks:");
  for (const r of succeeded) {
    console.log(`  ${r.symbol.padEnd(30)} ${r.hash.slice(0, 12)}...`);
  }

  console.log("\n✓ done");
}

main().catch((err) => { console.error(err); process.exit(1); });
