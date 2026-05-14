import type { Chunk } from '../src/types.js';

export interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  DB: D1Database;
}

interface IngestRequest {
  chunks: Chunk[];
}

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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function processChunk(chunk: Chunk, env: Env): Promise<ChunkResult> {
  const description = chunk.description?.trim()
    || `${chunk.chunk_type} ${chunk.symbol} in ${chunk.file_path}`;

  try {
    const embedOutput = await env.AI.run("@cf/baai/bge-small-en-v1.5", {
      text: [description],
    }) as { data: number[][] };

    const vector = embedOutput.data[0];

    await env.VECTORIZE.upsert([{
      id: chunk.hash,
      values: vector,
      metadata: {
        symbol: chunk.symbol,
        file_path: chunk.file_path,
        chunk_type: chunk.chunk_type,
        description,
      },
    }]);

    await env.DB.prepare(
      `INSERT OR REPLACE INTO chunks (id, symbol, file_path, chunk_type, description) VALUES (?, ?, ?, ?, ?)`
    ).bind(chunk.hash, chunk.symbol, chunk.file_path, chunk.chunk_type, description).run();

    return { symbol: chunk.symbol, hash: chunk.hash, description, ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { symbol: chunk.symbol, hash: chunk.hash, description, ok: false, error };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/ingest") {
      let body: IngestRequest;
      try {
        body = await request.json() as IngestRequest;
      } catch {
        return jsonResponse({ success: false, error: "Invalid JSON body" }, 400);
      }

      if (!Array.isArray(body?.chunks)) {
        return jsonResponse({ success: false, error: "Missing or invalid 'chunks' array" }, 400);
      }

      const results: ChunkResult[] = [];
      for (const chunk of body.chunks) {
        const result = await processChunk(chunk, env);
        results.push(result);
      }

      return jsonResponse({ success: true, processed: results.length, results } satisfies IngestResponse);
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
} satisfies ExportedHandler<Env>;
