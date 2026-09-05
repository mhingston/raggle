#!/usr/bin/env node

import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { getSettings } from "../core/config";
import { loadEnv } from "../core/env";
import type { SearchMode } from "../core/models";
import { type IndexingProgress, indexDirectory } from "../ingestion/pipeline";
import { type SearchOptions, search } from "../search/index";
import { getGraphStore, getMetadataStore, getVectorStore } from "../storage";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

const TOOLS: Tool[] = [
  {
    name: "search",
    description:
      "Search the indexed Markdown knowledgebase using hybrid retrieval (semantic + BM25 + graph)",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        top_k: {
          type: "number",
          description: "Number of results to return",
          default: 10,
        },
        mode: {
          type: "string",
          enum: ["semantic", "bm25", "graph", "hybrid"],
          description: "Search mode",
          default: "hybrid",
        },
        rerank: {
          type: "boolean",
          description: "Whether to rerank results",
          default: true,
        },
        graph_seed: {
          type: "string",
          enum: ["bm25", "semantic", "hybrid"],
          description: "Seed source for graph-only search",
          default: "bm25",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "index",
    description: "Index a directory of Markdown files",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "Path to directory containing Markdown files",
        },
        extract_depth: {
          type: "string",
          enum: ["structural", "ner"],
          description: "Depth of information extraction",
          default: getSettings().extractDepth,
        },
        entity_types: {
          type: "array",
          items: { type: "string" },
          description: "Entity types to extract",
        },
        exclude: {
          type: "array",
          items: { type: "string" },
          description: "Root-relative glob patterns to exclude",
        },
        rebuild: {
          type: "boolean",
          description: "Rebuild the index from scratch",
          default: false,
        },
      },
      required: ["directory"],
    },
  },
  {
    name: "status",
    description: "Get the current indexing status",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

export async function startMCPServer(): Promise<void> {
  loadEnv();
  const server = new Server(
    {
      name: "raggle",
      version: pkg.version,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "search": {
          const query = args?.query as string;
          const topK = (args?.top_k as number) ?? 10;
          const mode = (args?.mode as SearchMode) ?? "hybrid";
          const rerank = (args?.rerank as boolean) ?? true;
          const graphSeed = (args?.graph_seed as "bm25" | "semantic" | "hybrid") ?? "bm25";

          if (!query) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: query is required",
                },
              ],
              isError: true,
            };
          }

          const options: SearchOptions = {
            mode,
            topK,
            rerank,
            expand: true,
            graphSeed,
          };

          const results = await search(query, options);

          if (results.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "No results found. The index may be empty or the query did not match any documents.",
                },
              ],
            };
          }

          const formatted = results
            .map((result, i) => {
              return [
                `${i + 1}. ${result.headingPath || "Untitled"}`,
                `   File: ${result.filePath}`,
                `   Relevance: ${(result.fusedScore * 100).toFixed(1)}%`,
                `   Matched by: ${result.matchedEngines.join(", ")}`,
                `   Excerpt: ${result.snippet.replace(/\n/g, " ")}`,
              ].join("\n");
            })
            .join("\n\n");

          return {
            content: [
              {
                type: "text",
                text: `Found ${results.length} results for "${query}":\n\n${formatted}`,
              },
            ],
          };
        }

        case "index": {
          const directory = args?.directory as string;
          const extractDepth =
            (args?.extract_depth as "structural" | "ner") ?? getSettings().extractDepth;
          const entityTypes = args?.entity_types as string[] | undefined;
          const exclude = args?.exclude as string[] | undefined;
          const rebuild = (args?.rebuild as boolean) ?? false;

          if (!directory) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: directory is required",
                },
              ],
              isError: true,
            };
          }

          const progressMessages: string[] = [];

          const result = await indexDirectory(directory, {
            extractDepth,
            entityTypes,
            exclude,
            rebuild,
            onProgress: (progress: IndexingProgress) => {
              progressMessages.push(
                `[${progress.phase}] ${progress.current}/${progress.total}: ${progress.message}`
              );
            },
          });

          return {
            content: [
              {
                type: "text",
                text: [
                  `Indexing complete!`,
                  ``,
                  `Files processed: ${result.filesProcessed}`,
                  `Chunks created: ${result.chunksCreated}`,
                  `Entities extracted: ${result.entitiesExtracted}`,
                  `Edges created: ${result.edgesCreated}`,
                  `Duration: ${(result.durationMs / 1000).toFixed(2)}s`,
                  ``,
                  `Progress log:`,
                  ...progressMessages.slice(-10),
                ].join("\n"),
              },
            ],
          };
        }

        case "status": {
          const metadataStore = getMetadataStore();
          const vectorStore = getVectorStore();
          const graphStore = getGraphStore();

          const stats = metadataStore.getStats();

          if (!stats) {
            return {
              content: [
                {
                  type: "text",
                  text: "No index found. Run the 'index' tool to create an index.",
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: [
                  `Index Status:`,
                  ``,
                  `Total files: ${stats.totalFiles}`,
                  `Total chunks: ${stats.totalChunks}`,
                  `Total entities: ${stats.totalEntities}`,
                  `Total edges: ${stats.totalEdges}`,
                  `Vectors indexed: ${vectorStore.count()}`,
                  `Graph nodes: ${graphStore.nodeCount()}`,
                  `Graph edges: ${graphStore.edgeCount()}`,
                  stats.lastIndexed ? `Last indexed: ${stats.lastIndexed.toISOString()}` : "",
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
            ],
          };
        }

        default:
          return {
            content: [
              {
                type: "text",
                text: `Unknown tool: ${name}`,
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep the process alive
  process.stdin.resume();
}

// Start server if run directly
if (import.meta.main) {
  startMCPServer().catch((error) => {
    console.error("Fatal error starting MCP server:", error);
    process.exit(1);
  });
}
