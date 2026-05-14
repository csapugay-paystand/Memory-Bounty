import { chunkFile } from "./chunker.js";
import { readdir, stat } from "fs/promises";
import { join, resolve, extname } from "path";
import type { Chunk } from "./types.js";

interface ChunkResult {
  symbol: string;
  hash: string;
  description: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

interface IngestResponse {
  success: boolean;
  processed: number;
  skipped: number;
  results: ChunkResult[];
}

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".py", ".go"]);
const BATCH_SIZE = 10;

async function collectFiles(inputPath: string): Promise<string[]> {
  const abs = resolve(inputPath);
  const info = await stat(abs);

  if (info.isFile()) {
    const ext = extname(abs).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      console.warn(`→ skipping unsupported file type: ${abs}`);
      return [];
    }
    return [abs];
  }

  if (info.isDirectory()) {
    return walkDirectory(abs);
  }

  return [];
}

async function walkDirectory(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const sub = await walkDirectory(fullPath);
      results.push(...sub);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

function parseArgs(argv: string[]): { inputPath: string; repo: string } {
  // argv = process.argv.slice(2)
  let inputPath = "";
  let repo = "";

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--repo" && i + 1 < argv.length) {
      repo = argv[++i]!;
    } else if (!argv[i]!.startsWith("--")) {
      inputPath = argv[i]!;
    }
  }

  return { inputPath, repo };
}

async function postBatch(
  chunks: Chunk[],
  repo: string,
  workerUrl: string
): Promise<IngestResponse> {
  const response = await fetch(`${workerUrl}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chunks, repo: repo || undefined }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Worker returned HTTP ${response.status}: ${text}`);
  }

  return (await response.json()) as IngestResponse;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.inputPath) {
    console.error("Usage: ingest <file-or-directory> [--repo <name>]");
    console.error("Example: npx tsx src/ingest.ts ./src --repo payments-api");
    process.exit(1);
  }

  const workerUrl = process.env["WORKER_URL"];
  if (!workerUrl) {
    console.error("Error: WORKER_URL environment variable is not set.");
    console.error("Example: WORKER_URL=http://localhost:8787 npx tsx src/ingest.ts ./src --repo my-repo");
    process.exit(1);
  }

  const repo = args.repo || args.inputPath;
  const startTime = Date.now();

  // Collect all files
  let files: string[];
  try {
    files = await collectFiles(args.inputPath);
  } catch (err) {
    console.error(`Error reading path: ${args.inputPath}`);
    console.error(err);
    process.exit(1);
  }

  if (files.length === 0) {
    console.log("→ No supported files found.");
    process.exit(0);
  }

  console.log(`→ found ${files.length} file(s)`);

  // Chunk each file
  const allChunks: Chunk[] = [];
  for (const file of files) {
    let fileChunks: Chunk[];
    try {
      fileChunks = await chunkFile(file);
    } catch (err) {
      console.warn(`→ skipping ${file}: ${(err as Error).message}`);
      continue;
    }

    if (fileChunks.length > 0) {
      console.log(`→ chunking ${file} (${fileChunks.length} symbols)`);
      allChunks.push(...fileChunks);
    }
  }

  if (allChunks.length === 0) {
    console.log("→ No extractable chunks found.");
    process.exit(0);
  }

  console.log(`→ sending ${allChunks.length} chunks to Worker for description + embedding...`);

  // Batch POST requests
  const allResults: ChunkResult[] = [];
  let totalProcessed = 0;
  let totalSkipped = 0;

  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(allChunks.length / BATCH_SIZE);
    process.stdout.write(`  batch ${batchNum}/${totalBatches}... `);

    try {
      const data = await postBatch(batch, repo, workerUrl);
      allResults.push(...data.results);
      totalProcessed += data.processed;
      totalSkipped += data.skipped ?? 0;
      console.log(`done (${data.skipped ?? 0} skipped)`);
    } catch (err) {
      console.error(`\nError in batch ${batchNum}: ${(err as Error).message}`);
    }
  }

  const failed = allResults.filter((r) => !r.ok);
  const stored = allResults.filter((r) => r.ok && !r.skipped);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n→ ${files.length} files processed, ${stored.length} chunks stored, ${totalSkipped} skipped`);

  if (failed.length > 0) {
    console.warn(`\n⚠ ${failed.length} chunk(s) failed:`);
    for (const r of failed) {
      console.warn(`  ${r.symbol}: ${r.error}`);
    }
  }

  console.log(`✓ done in ${elapsed}s`);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
