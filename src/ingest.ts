import { chunkFile } from "./chunker.js";

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

  let chunks;
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
  console.log(`→ sending to Worker for description + embedding...`);

  let data: IngestResponse;
  try {
    const response = await fetch(`${workerUrl}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunks }),
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
