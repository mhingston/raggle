#!/usr/bin/env bun

import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { getSettings } from "./core/config";
import { loadEnv } from "./core/env";
import type { SearchMode } from "./core/models";
import { type IndexingProgress, indexDirectory } from "./ingestion/pipeline";
import { type SearchOptions, search } from "./search/index";
import { getGraphStore, getMetadataStore, getVectorStore } from "./storage";

if (!process.versions?.bun) {
  console.error("raggle requires Bun. Install Bun and rerun: https://bun.sh");
  process.exit(1);
}

const program = new Command();

loadEnv();

program
  .name("raggle")
  .description("Markdown knowledgebase indexer with hybrid search")
  .version("0.1.0");

program
  .command("index")
  .description("Index a directory of Markdown files")
  .argument("<directory>", "Directory containing Markdown files")
  .option(
    "--extract-depth <depth>",
    "Extraction depth (structural|ner)",
    getSettings().extractDepth
  )
  .option("--entity-types <types>", "Comma-separated list of entity types to extract")
  .option("--rebuild", "Rebuild the index from scratch", false)
  .action(async (directory: string, options) => {
    try {
      console.log(`Indexing directory: ${directory}`);
      console.log("This may take a while for large collections...\n");

      const result = await indexDirectory(directory, {
        extractDepth: options.extractDepth as "structural" | "ner",
        entityTypes: options.entityTypes?.split(",").map((t: string) => t.trim()),
        rebuild: options.rebuild,
        onProgress: (progress: IndexingProgress) => {
          const percentage =
            progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
          process.stdout.write(`\r[${percentage}%] ${progress.message}`);
        },
      });

      console.log("\n\nIndexing complete!");
      console.log(`  Files processed: ${result.filesProcessed}`);
      console.log(`  Chunks created: ${result.chunksCreated}`);
      console.log(`  Entities extracted: ${result.entitiesExtracted}`);
      console.log(`  Edges created: ${result.edgesCreated}`);
      console.log(`  Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
    } catch (error) {
      console.error("\nError during indexing:", error);
      process.exit(1);
    }
  });

program
  .command("search")
  .description("Search the indexed knowledgebase")
  .argument("<query>", "Search query")
  .option("--mode <mode>", "Search mode (semantic|bm25|graph|hybrid)", "hybrid")
  .option("--graph-seed <mode>", "Seed source for graph-only search (bm25|semantic|hybrid)", "bm25")
  .option("--top <n>", "Number of results to return", "10")
  .option("--no-rerank", "Disable reranking")
  .option("--no-expand", "Disable query expansion with acronyms")
  .action(async (query: string, options) => {
    try {
      const searchOptions: SearchOptions = {
        mode: options.mode as SearchMode,
        topK: parseInt(options.top, 10),
        rerank: options.rerank,
        expand: options.expand,
        graphSeed: options.graphSeed as "bm25" | "semantic" | "hybrid",
      };

      console.log(`Searching for: "${query}"`);
      console.log(`Mode: ${searchOptions.mode}\n`);

      const results = await search(query, searchOptions);

      if (results.length === 0) {
        console.log("No results found.");
        return;
      }

      console.log(`Found ${results.length} results:\n`);

      for (const result of results) {
        console.log(`${result.headingPath || "Untitled"}`);
        console.log(`   File: ${result.filePath}`);
        console.log(`   Score: ${result.fusedScore.toFixed(4)}`);
        console.log(`   Engines: ${result.matchedEngines.join(", ")}`);

        if (result.semanticScore !== undefined) {
          console.log(`   Semantic: ${result.semanticScore.toFixed(4)}`);
        }
        if (result.bm25Score !== undefined) {
          console.log(`   BM25: ${result.bm25Score.toFixed(4)}`);
        }
        if (result.graphScore !== undefined) {
          console.log(`   Graph: ${result.graphScore.toFixed(4)}`);
        }

        console.log(`   Snippet: ${result.snippet.replace(/\n/g, " ")}\n`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("No index found")) {
        console.error(error.message);
      } else {
        console.error("Error during search:", error);
      }
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show indexing status")
  .action(() => {
    try {
      const metadataStore = getMetadataStore();
      const vectorStore = getVectorStore();
      const graphStore = getGraphStore();

      const stats = metadataStore.getStats();

      if (!stats) {
        console.log("No index found.");
        const settings = getSettings();
        console.log(`  Index directory: ${settings.indexDir}`);
        console.log("Run 'raggle index <directory>' to create an index.");
        return;
      }

      const settings = getSettings();

      console.log("Index Status:");
      console.log(`  Index directory: ${settings.indexDir}`);
      console.log(`  Total files: ${stats.totalFiles}`);
      console.log(`  Total chunks: ${stats.totalChunks}`);
      console.log(`  Total entities: ${stats.totalEntities}`);
      console.log(`  Total edges: ${stats.totalEdges}`);
      console.log(`  Vectors: ${vectorStore.count()}`);
      console.log(`  Graph nodes: ${graphStore.nodeCount()}`);
      console.log(`  Graph edges: ${graphStore.edgeCount()}`);

      if (stats.lastIndexed) {
        console.log(`  Last indexed: ${stats.lastIndexed.toLocaleString()}`);
      }
    } catch (error) {
      console.error("Error getting status:", error);
      process.exit(1);
    }
  });

program
  .command("clear")
  .description("Clear the index")
  .action(async () => {
    try {
      const settings = getSettings();
      const metadataStore = getMetadataStore();
      const vectorStore = getVectorStore();
      const graphStore = getGraphStore();

      metadataStore.deleteAll();
      vectorStore.deleteAll();
      graphStore.deleteAll();

      const { existsSync, unlinkSync } = await import("node:fs");
      const { join } = await import("node:path");
      const bm25Path = join(settings.indexDir, "bm25_index.json");
      if (existsSync(bm25Path)) {
        unlinkSync(bm25Path);
      }
      const acronymPath = join(settings.indexDir, "acronyms.json");
      if (existsSync(acronymPath)) {
        unlinkSync(acronymPath);
      }

      console.log("Index cleared successfully.");
    } catch (error) {
      console.error("Error clearing index:", error);
      process.exit(1);
    }
  });

program
  .command("mcp")
  .description("Start MCP server (stdio mode)")
  .action(async () => {
    const { startMCPServer } = await import("./mcp/server");
    await startMCPServer();
  });

program
  .command("mcp-config")
  .description("Output MCP configuration for Claude/Cursor")
  .action(() => {
    const cliPath = fileURLToPath(import.meta.url);
    const config = {
      mcpServers: {
        raggle: {
          command: "bun",
          args: ["run", cliPath, "mcp"],
          env: {
            RAGGLE_INDEX_DIR: getSettings().indexDir,
          },
        },
      },
    };

    console.log(JSON.stringify(config, null, 2));
  });

program.parse();
