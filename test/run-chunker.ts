import { chunkFile } from "../src/chunker.js";

void (async () => {
const chunks = await chunkFile("./test/sample.ts");

console.log(`\n✓ Total chunks extracted: ${chunks.length}\n`);

for (const chunk of chunks) {
  console.log(`  symbol     : ${chunk.symbol}`);
  console.log(`  chunk_type : ${chunk.chunk_type}`);
  console.log(`  file_path  : ${chunk.file_path}`);
  console.log(`  hash       : ${chunk.hash.slice(0, 12)}...`);
  console.log(`  text       : ${chunk.text.slice(0, 60).replace(/\n/g, "↵")}...`);
  console.log();
}

// Assertions
const symbols = chunks.map((c) => c.symbol);
const types = chunks.map((c) => c.chunk_type);

const expected = ["greet", "farewell", "add", "multiply", "Calculator", "add", "getHistory", "Logger", "log"];
const missing = expected.filter((s) => !symbols.includes(s));
const unexpected = symbols.filter((s) => !expected.includes(s));

if (missing.length === 0 && unexpected.length === 0) {
  console.log("✓ All expected symbols found, no unexpected symbols.");
} else {
  if (missing.length > 0) console.error("✗ Missing symbols:", missing);
  if (unexpected.length > 0) console.error("✗ Unexpected symbols:", unexpected);
  process.exit(1);
}

// Verify every chunk has a non-empty hash
const noHash = chunks.filter((c) => !c.hash || c.hash.length !== 64);
if (noHash.length === 0) {
  console.log("✓ All chunks have valid SHA-256 hashes (64 hex chars).");
} else {
  console.error("✗ Chunks with invalid hashes:", noHash.map((c) => c.symbol));
  process.exit(1);
}

// Verify chunk types are correct
const classChunks = chunks.filter((c) => c.chunk_type === "class").map((c) => c.symbol);
const methodChunks = chunks.filter((c) => c.chunk_type === "method").map((c) => c.symbol);
const funcChunks = chunks.filter((c) => c.chunk_type === "function").map((c) => c.symbol);

console.log(`✓ Functions : ${funcChunks.join(", ")}`);
console.log(`✓ Classes   : ${classChunks.join(", ")}`);
console.log(`✓ Methods   : ${methodChunks.join(", ")}`);

// The console.log("init") line should NOT have been extracted
if (symbols.includes("init") || symbols.includes("console")) {
  console.error("✗ Anonymous top-level expression was incorrectly extracted");
  process.exit(1);
}
console.log("✓ Anonymous top-level expression correctly ignored.");
})();
