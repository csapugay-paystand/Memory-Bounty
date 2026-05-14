import { Agent, CursorAgentError } from "@cursor/sdk";
import { chunkFile } from "./chunker.js";
import type { Chunk } from "./types.js";

interface ChunkResult {
  symbol: string;
  hash: string;
  description: string;
  ok: boolean;
  error?: string;
}

interface IngestResponse {
  success: boolean;
  processed: number;
  results: ChunkResult[];
}

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
      throw new Error(`Cursor SDK error: ${err.message} (retryable=${err.isRetryable})`);
    }
    throw err;
  }
}

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: ingest <file-path>");
    console.error("Example: npx tsx src/ingest.ts ./src/payments/webhooks.ts");
    process.exit(1);
  }

  const workerUrl = process.env["WORKER_URL"];
  if (!workerUrl) {
    console.error("Error: WORKER_URL environment variable is not set.");
    console.error("Example: WORKER_URL=https://memory-bounty.<account>.workers.dev npx tsx src/ingest.ts <file>");
    process.exit(1);
  }

  const cursorApiKey = process.env["CURSOR_API_KEY"];
  if (!cursorApiKey) {
    console.error("Error: CURSOR_API_KEY environment variable is not set.");
    console.error("Get your API key from https://cursor.com/dashboard/cloud-agents");
    process.exit(1);
  }

  let chunks: Chunk[];
  try {
    chunks = await chunkFile(filePath);
  } catch (err) {
    console.error(`Error reading/parsing file: ${filePath}`);
    console.error(err);
    process.exit(1);
  }

  if (chunks.length === 0) {
    console.log("→ No extractable chunks found in file (no top-level functions or classes).");
    process.exit(0);
  }

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
      process.stdout.write(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
      enrichedChunks.push({ ...chunk, description: `${chunk.chunk_type} ${chunk.symbol} in ${chunk.file_path}` });
    }
  }

  console.log(`→ descriptions written`);

  let data: IngestResponse;
  try {
    const response = await fetch(`${workerUrl}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunks: enrichedChunks }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Worker returned HTTP ${response.status}: ${text}`);
      process.exit(1);
    }

    data = (await response.json()) as IngestResponse;
  } catch (err) {
    console.error("Error contacting Worker:");
    console.error(err);
    process.exit(1);
  }

  const failed = data.results.filter((r) => !r.ok);
  const succeeded = data.results.filter((r) => r.ok);

  console.log(`→ stored in Vectorize + D1 (${succeeded.length}/${data.processed} chunks)`);

  if (failed.length > 0) {
    console.warn(`\n⚠ ${failed.length} chunk(s) failed:`);
    for (const r of failed) {
      console.warn(`  ${r.symbol}: ${r.error}`);
    }
  }

  if (succeeded.length > 0) {
    console.log("\nStored chunks:");
    for (const r of succeeded) {
      console.log(`  ${r.symbol.padEnd(30)} ${r.hash.slice(0, 12)}...`);
    }
  }

  console.log("\n✓ done");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
