import { createHash } from "crypto";
import { readFile } from "fs/promises";
import type { Chunk, ChunkType } from "./types.js";

// tree-sitter ships native bindings without ESM exports; use require in CJS context
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Parser = require("tree-sitter");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TypeScript = require("tree-sitter-typescript");

type SyntaxNode = {
  type: string;
  text: string;
  startIndex: number;
  endIndex: number;
  children: SyntaxNode[];
  childForFieldName: (name: string) => SyntaxNode | null;
  namedChildren: SyntaxNode[];
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function getSymbolFromNode(node: SyntaxNode): string | null {
  const nameNode = node.childForFieldName("name");
  if (nameNode) {
    const t = nameNode.type;
    return t === "identifier" || t === "type_identifier" || t === "property_identifier"
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

function extractArrowFunctionChunks(
  node: SyntaxNode,
  source: string,
  filePath: string
): Chunk[] {
  const chunks: Chunk[] = [];
  // Walk declarators inside lexical_declaration / variable_declaration
  for (const child of node.namedChildren) {
    if (child.type === "variable_declarator") {
      const valueNode = child.childForFieldName("value");
      if (valueNode && valueNode.type === "arrow_function") {
        const nameNode = child.childForFieldName("name");
        if (nameNode) {
          const symbol = extractText(nameNode, source);
          if (symbol) {
            chunks.push(buildChunk(node, symbol, source, filePath, "function"));
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

export async function chunkFile(filePath: string): Promise<Chunk[]> {
  const source = await readFile(filePath, "utf8");

  const parser = new Parser();
  parser.setLanguage(TypeScript.typescript);
  const tree = parser.parse(source);

  const chunks: Chunk[] = [];
  const rootChildren: SyntaxNode[] = tree.rootNode.children;

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
        // Also extract methods from the class body
        chunks.push(...extractMethodChunks(node, source, filePath));
        break;
      }

      case "lexical_declaration":
      case "variable_declaration": {
        const arrowChunks = extractArrowFunctionChunks(node, source, filePath);
        chunks.push(...arrowChunks);
        break;
      }

      case "export_statement": {
        // Handle exported declarations: export function foo() {}, export class Foo {}, export const foo = () => {}
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
          const arrowChunks = extractArrowFunctionChunks(declarationNode, source, filePath);
          chunks.push(...arrowChunks);
        }
        break;
      }

      default:
        break;
    }
  }

  return chunks;
}
