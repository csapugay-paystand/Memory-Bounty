import { chunkFile } from "../src/chunker.js";

void (async () => {
  const file = process.argv[2] ?? "./test/example-payment-service.ts";
  const chunks = await chunkFile(file);

  console.log(`\nFile: ${file}`);
  console.log(`Chunks: ${chunks.length}\n`);

  for (const c of chunks) {
    console.log(`[${c.chunk_type.padEnd(8)}] ${c.symbol}`);
    console.log(`  hash : ${c.hash.slice(0, 16)}...`);
    console.log(`  lines: ${c.text.split("\n").length}`);
    console.log();
  }
})();
