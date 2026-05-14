import type { Chunk } from '../src/types.js';

export interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  DB: D1Database;
  CHUNKS_BUCKET: R2Bucket;
}

interface IngestRequest {
  chunks: Chunk[];
  repo?: string;
}

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

function descriptionPrompt(chunk: Chunk): string {
  return `You are building a searchable memory layer for a codebase. Write 2-3 sentences describing the following code chunk so a developer can find it through semantic search. Focus on: what this code does, why it exists, and what concepts or keywords someone would search to find it. Write from the perspective of a searcher, not a reader. Do not narrate line by line. Respond with only the description — no preamble, no code fences. Do NOT begin your response with "This code", "This function", "The function", "This class", or any similar phrase. Start directly with the concept, domain, or action.

Symbol: ${chunk.symbol} (${chunk.chunk_type})
File: ${chunk.file_path}

Code:
${chunk.text}`;
}

async function generateDescription(chunk: Chunk, env: Env): Promise<string> {
  const fallback = `${chunk.chunk_type} ${chunk.symbol} in ${chunk.file_path}`;

  try {
    const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        { role: "user", content: descriptionPrompt(chunk) },
      ],
      max_tokens: 256,
    }) as { response?: string };

    const text = response.response?.trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}

async function processChunk(chunk: Chunk, env: Env, repo?: string): Promise<ChunkResult> {
  try {
    // SHA-256 deduplication: skip if this hash already exists in D1
    const existing = await env.DB.prepare(
      `SELECT id, description FROM chunks WHERE id = ?`
    ).bind(chunk.hash).first<{ id: string; description: string }>();

    if (existing) {
      return { symbol: chunk.symbol, hash: chunk.hash, description: existing.description ?? "", ok: true, skipped: true };
    }

    const description = await generateDescription(chunk, env);

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
        ...(repo ? { repo } : {}),
      },
    }]);

    // Store raw source in R2
    const r2Key = `chunks/${chunk.hash}`;
    await env.CHUNKS_BUCKET.put(r2Key, chunk.text, {
      customMetadata: {
        symbol: chunk.symbol,
        file_path: chunk.file_path,
        chunk_type: chunk.chunk_type,
      },
    });

    await env.DB.prepare(
      `INSERT OR REPLACE INTO chunks (id, symbol, file_path, chunk_type, description, repo, source_key) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(chunk.hash, chunk.symbol, chunk.file_path, chunk.chunk_type, description, repo ?? null, r2Key).run();

    return { symbol: chunk.symbol, hash: chunk.hash, description, ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { symbol: chunk.symbol, hash: chunk.hash, description: "", ok: false, error };
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
        const result = await processChunk(chunk, env, body.repo);
        results.push(result);
      }

      const skippedCount = results.filter((r) => r.skipped).length;

      return jsonResponse({
        success: true,
        processed: results.length,
        skipped: skippedCount,
        results,
      } satisfies IngestResponse);
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
} satisfies ExportedHandler<Env>;
