/**
 * Local integration test for src/ingest.ts.
 * Spins up a minimal HTTP server mimicking the Worker's /ingest and /health
 * endpoints — no Cloudflare credentials required.
 * Cursor SDK calls are bypassed by injecting pre-set descriptions via
 * a mock CURSOR_API_KEY env var (the CLI only validates presence, not format).
 *
 * Run: npx tsx test/test-ingest-local.ts
 */
import { createServer } from "http";
import { spawn, spawnSync } from "child_process";
import { chunkFile } from "../src/chunker.js";
import type { Chunk } from "../src/types.js";

interface ChunkResult {
  symbol: string;
  hash: string;
  description: string;
  ok: boolean;
  error?: string;
}

const PORT = 18_322;
const WORKER_URL = `http://localhost:${PORT}`;
// A non-empty value so the CLI's env-var guard passes.
// The Cursor SDK is not actually invoked in tests because we stub the
// Agent.prompt call by patching the module (see note below).
const MOCK_CURSOR_API_KEY = "cursor_test_mock_key";

let receivedChunks: Chunk[] = [];
let passCount = 0;
let failCount = 0;

function assert(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passCount++;
  } else {
    console.error(`  ✗ ${label}`);
    failCount++;
  }
}

function spawnAsync(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

// --- Minimal mock Worker server ---
const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && req.url === "/ingest") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body) as { chunks: Chunk[] };
        receivedChunks = parsed.chunks;

        const results: ChunkResult[] = parsed.chunks.map((c) => ({
          symbol: c.symbol,
          hash: c.hash,
          description: c.description ?? `${c.chunk_type} ${c.symbol}`,
          ok: true,
        }));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, processed: results.length, results }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

async function runTests() {
  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.log(`\nMock Worker listening on ${WORKER_URL}\n`);

  // --- Test 1: Health check ---
  console.log("Test 1: GET /health");
  {
    const res = await fetch(`${WORKER_URL}/health`);
    const body = await res.json() as { ok: boolean };
    assert("status 200", res.status === 200);
    assert("body.ok is true", body.ok === true);
  }

  // --- Test 2: Missing file argument ---
  console.log("\nTest 2: ingest.ts — missing file argument");
  {
    const result = spawnSync("npx", ["tsx", "src/ingest.ts"], {
      env: { ...process.env, WORKER_URL, CURSOR_API_KEY: MOCK_CURSOR_API_KEY },
      encoding: "utf8",
    });
    assert("exits with code 1", result.status === 1);
    assert("prints usage", result.stderr.includes("Usage:"));
  }

  // --- Test 3: Missing WORKER_URL ---
  console.log("\nTest 3: ingest.ts — missing WORKER_URL");
  {
    const env = { ...process.env, CURSOR_API_KEY: MOCK_CURSOR_API_KEY };
    delete env["WORKER_URL"];
    const result = spawnSync("npx", ["tsx", "src/ingest.ts", "./test/sample.ts"], {
      env,
      encoding: "utf8",
    });
    assert("exits with code 1", result.status === 1);
    assert("prints WORKER_URL error", result.stderr.includes("WORKER_URL"));
  }

  // --- Test 4: Missing CURSOR_API_KEY ---
  console.log("\nTest 4: ingest.ts — missing CURSOR_API_KEY");
  {
    const env = { ...process.env, WORKER_URL };
    delete env["CURSOR_API_KEY"];
    const result = spawnSync("npx", ["tsx", "src/ingest.ts", "./test/sample.ts"], {
      env,
      encoding: "utf8",
    });
    assert("exits with code 1", result.status === 1);
    assert("prints CURSOR_API_KEY error", result.stderr.includes("CURSOR_API_KEY"));
  }

  // --- Test 5: Full ingest CLI flow against mock Worker ---
  // The Cursor SDK Agent.prompt is mocked via TSX_TSCONFIG_PATH override
  // and a small shim that replaces @cursor/sdk at import time.
  console.log("\nTest 5: Full CLI ingest flow (mock Worker + mock Cursor SDK)");
  {
    // We use a separate entry-point that stubs Agent.prompt and calls main
    const result = await spawnAsync(
      "npx",
      ["tsx", "test/ingest-with-mock-sdk.ts", "./test/sample.ts"],
      { ...process.env, WORKER_URL, CURSOR_API_KEY: MOCK_CURSOR_API_KEY }
    );

    assert("exits with code 0", result.code === 0);
    assert("prints '→ chunked'", result.stdout.includes("→ chunked"));
    assert("prints '→ descriptions written'", result.stdout.includes("→ descriptions written"));
    assert("prints '→ stored in Vectorize + D1'", result.stdout.includes("→ stored in Vectorize + D1"));
    assert("prints '✓ done'", result.stdout.includes("✓ done"));

    if (result.code !== 0) {
      console.error("  stdout:", result.stdout);
      console.error("  stderr:", result.stderr);
    }
  }

  // --- Test 6: Chunks sent to Worker have descriptions ---
  console.log("\nTest 6: Chunks sent to Worker are correct");
  {
    const expectedSymbols = ["greet", "farewell", "add", "multiply", "Calculator", "Logger"];
    const sentSymbols = receivedChunks.map((c) => c.symbol);

    for (const sym of expectedSymbols) {
      assert(`symbol '${sym}' was sent`, sentSymbols.includes(sym));
    }

    assert("all chunks have 64-char SHA-256 hashes", receivedChunks.every((c) => c.hash.length === 64));
    assert("all chunks have non-empty text", receivedChunks.every((c) => c.text.length > 0));
    assert("all chunks have descriptions", receivedChunks.every((c) => !!c.description));
    assert(
      "all chunk types are valid",
      receivedChunks.every((c) => ["function", "class", "method"].includes(c.chunk_type))
    );
  }

  // --- Test 7: POST /ingest — malformed body ---
  console.log("\nTest 7: POST /ingest — malformed JSON body");
  {
    const res = await fetch(`${WORKER_URL}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    });
    assert("returns non-200", res.status !== 200);
  }

  // --- Test 8: Chunker content correctness ---
  console.log("\nTest 8: Chunker output content correctness");
  {
    const chunks = await chunkFile("./test/sample.ts");

    const calcClass = chunks.find((c) => c.symbol === "Calculator");
    assert("Calculator chunk_type is 'class'", calcClass?.chunk_type === "class");
    assert("Calculator text includes class body", calcClass?.text.includes("private history") ?? false);

    const addMethod = chunks.find((c) => c.symbol === "add" && c.chunk_type === "method");
    assert("'add' method chunk exists", addMethod !== undefined);
    assert(
      "method text is scoped, not the whole class",
      (addMethod?.text.length ?? 0) < (calcClass?.text.length ?? 1)
    );

    const multiplyFn = chunks.find((c) => c.symbol === "multiply");
    assert("'multiply' chunk_type is 'function'", multiplyFn?.chunk_type === "function");

    const hashes = new Set(chunks.map((c) => c.hash));
    assert("all hashes are unique", hashes.size === chunks.length);
  }

  // --- Summary ---
  server.close();
  console.log(`\n${"─".repeat(40)}`);
  console.log(`Results: ${passCount} passed, ${failCount} failed`);

  if (failCount > 0) process.exit(1);
  else console.log("✓ All tests passed");
}

runTests().catch((err) => {
  console.error("Test runner error:", err);
  server.close();
  process.exit(1);
});
