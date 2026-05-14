export type ChunkType = "function" | "class" | "method";

export interface Chunk {
  symbol: string;      // e.g. "handleWebhookEvent"
  text: string;        // raw source code of the chunk
  file_path: string;   // e.g. "src/payments/webhooks.ts"
  chunk_type: ChunkType;
  hash: string;        // SHA-256 of text, for future dedup
  description?: string; // filled in by the Worker after description writing
}
