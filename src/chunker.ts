import { createHash } from "crypto";
import { readFile } from "fs/promises";
import { extname } from "path";
import type { Chunk, ChunkType } from "./types.js";

// tree-sitter ships native bindings without ESM exports; use require in CJS context
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Parser = require("tree-sitter");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TypeScript = require("tree-sitter-typescript");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const JavaScript = require("tree-sitter-javascript");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Python = require("tree-sitter-python");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Go = require("tree-sitter-go");

type SyntaxNode = {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  children: SyntaxNode[];
  childForFieldName: (name: string) => SyntaxNode | null;
  namedChildren: SyntaxNode[];
};

type Language = "typescript" | "javascript" | "python" | "go";

interface LangInfo {
  grammar: unknown;
  lang: Language;
}

function detectLanguage(filePath: string): LangInfo | null {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":  return { grammar: TypeScript.typescript, lang: "typescript" };
    case ".tsx": return { grammar: TypeScript.tsx, lang: "typescript" };
    case ".js":
    case ".jsx": return { grammar: JavaScript, lang: "javascript" };
    case ".py":  return { grammar: Python, lang: "python" };
    case ".go":  return { grammar: Go, lang: "go" };
    default:     return null;
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function getSymbolFromNode(node: SyntaxNode): string | null {
  const nameNode = node.childForFieldName("name");
  if (nameNode) {
    const t = nameNode.type;
    return t === "identifier" || t === "type_identifier" || t === "property_identifier" || t === "field_identifier"
      ? nameNode.text
      : null;
  }
  return null;
}

function extractText(node: SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

function buildChunk(
  node: SyntaxNode,
  symbol: string,
  source: string,
  filePath: string,
  chunkType: ChunkType
): Chunk {
  const text = extractText(node, source);
  return {
    symbol,
    text,
    file_path: filePath,
    chunk_type: chunkType,
    hash: sha256(text),
  };
}

// --- TypeScript / JavaScript walkers ---

function extractArrowFunctionChunks(
  node: SyntaxNode,
  source: string,
  filePath: string
): Chunk[] {
  const chunks: Chunk[] = [];
  for (const child of node.namedChildren) {
    if (child.type === "variable_declarator") {
      const valueNode = child.childForFieldName("value");
      if (valueNode && valueNode.type === "arrow_function") {
        const nameNode = child.childForFieldName("name");
        if (nameNode) {
          const symbol = extractText(nameNode, source);
          if (symbol) {
            // Use valueNode (the arrow function itself) as the text span, not the full declaration
            chunks.push(buildChunk(valueNode, symbol, source, filePath, "function"));
          }
        }
      }
    }
  }
  return chunks;
}

function extractMethodChunks(
  classNode: SyntaxNode,
  source: string,
  filePath: string
): Chunk[] {
  const chunks: Chunk[] = [];
  const bodyNode = classNode.childForFieldName("body");
  if (!bodyNode) return chunks;

  for (const child of bodyNode.namedChildren) {
    if (child.type === "method_definition") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) {
        const symbol = extractText(nameNode, source);
        if (symbol) {
          chunks.push(buildChunk(child, symbol, source, filePath, "method"));
        }
      }
    }
  }
  return chunks;
}

function walkJsTs(rootChildren: SyntaxNode[], source: string, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];

  for (const node of rootChildren) {
    switch (node.type) {
      case "function_declaration": {
        const symbol = getSymbolFromNode(node);
        if (symbol) {
          chunks.push(buildChunk(node, symbol, source, filePath, "function"));
        }
        break;
      }

      case "class_declaration": {
        const symbol = getSymbolFromNode(node);
        if (symbol) {
          chunks.push(buildChunk(node, symbol, source, filePath, "class"));
        }
        chunks.push(...extractMethodChunks(node, source, filePath));
        break;
      }

      case "lexical_declaration":
      case "variable_declaration": {
        chunks.push(...extractArrowFunctionChunks(node, source, filePath));
        break;
      }

      case "export_statement": {
        const declarationNode = node.childForFieldName("declaration");
        if (!declarationNode) break;

        if (declarationNode.type === "function_declaration") {
          const symbol = getSymbolFromNode(declarationNode);
          if (symbol) {
            chunks.push(buildChunk(declarationNode, symbol, source, filePath, "function"));
          }
        } else if (declarationNode.type === "class_declaration") {
          const symbol = getSymbolFromNode(declarationNode);
          if (symbol) {
            chunks.push(buildChunk(declarationNode, symbol, source, filePath, "class"));
          }
          chunks.push(...extractMethodChunks(declarationNode, source, filePath));
        } else if (
          declarationNode.type === "lexical_declaration" ||
          declarationNode.type === "variable_declaration"
        ) {
          chunks.push(...extractArrowFunctionChunks(declarationNode, source, filePath));
        }
        break;
      }

      default:
        break;
    }
  }

  return chunks;
}

// --- Python walker ---

function extractPythonMethods(classNode: SyntaxNode, source: string, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];
  const bodyNode = classNode.childForFieldName("body");
  if (!bodyNode) return chunks;

  for (const child of bodyNode.namedChildren) {
    if (child.type === "function_definition") {
      const nameNode = child.childForFieldName("name");
      if (nameNode) {
        const symbol = extractText(nameNode, source);
        // Skip dunder methods — they are infrastructure, not semantic units
        if (symbol && !symbol.startsWith("__")) {
          chunks.push(buildChunk(child, symbol, source, filePath, "method"));
        }
      }
    }
  }
  return chunks;
}

function walkPython(rootChildren: SyntaxNode[], source: string, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];

  for (const node of rootChildren) {
    switch (node.type) {
      case "function_definition": {
        const symbol = getSymbolFromNode(node);
        if (symbol) {
          chunks.push(buildChunk(node, symbol, source, filePath, "function"));
        }
        break;
      }

      case "class_definition": {
        const symbol = getSymbolFromNode(node);
        if (symbol) {
          chunks.push(buildChunk(node, symbol, source, filePath, "class"));
        }
        chunks.push(...extractPythonMethods(node, source, filePath));
        break;
      }

      default:
        break;
    }
  }

  return chunks;
}

// --- Go walker ---

function walkGo(rootChildren: SyntaxNode[], source: string, filePath: string): Chunk[] {
  const chunks: Chunk[] = [];

  for (const node of rootChildren) {
    switch (node.type) {
      case "function_declaration": {
        const symbol = getSymbolFromNode(node);
        if (symbol) {
          chunks.push(buildChunk(node, symbol, source, filePath, "function"));
        }
        break;
      }

      case "method_declaration": {
        // In Go, method names are field_identifier nodes under the "name" field
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          const symbol = extractText(nameNode, source);
          if (symbol) {
            chunks.push(buildChunk(node, symbol, source, filePath, "method"));
          }
        }
        break;
      }

      default:
        break;
    }
  }

  return chunks;
}

// --- Public entry point ---

export async function chunkFile(filePath: string): Promise<Chunk[]> {
  const langInfo = detectLanguage(filePath);
  if (!langInfo) {
    console.warn(`→ skipping unsupported file type: ${filePath}`);
    return [];
  }

  const source = await readFile(filePath, "utf8");
  const parser = new Parser();
  parser.setLanguage(langInfo.grammar);
  const tree = parser.parse(source);
  const rootChildren: SyntaxNode[] = tree.rootNode.children;

  switch (langInfo.lang) {
    case "typescript":
    case "javascript":
      return walkJsTs(rootChildren, source, filePath);
    case "python":
      return walkPython(rootChildren, source, filePath);
    case "go":
      return walkGo(rootChildren, source, filePath);
  }
}
