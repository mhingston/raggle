# raggle

raggle is a local-first Markdown knowledge base indexer. It builds a hybrid index (semantic + BM25 + graph) and exposes both a CLI and an MCP server for search and indexing.

## What It Does

- Indexes Markdown files and stores chunks, vectors, and a lightweight knowledge graph locally.
- Supports hybrid retrieval with reciprocal-rank fusion and optional reranking.
- Exposes an MCP server (stdio) for editor integrations.

## Use Cases

- Local knowledge base search for notes, docs, and project wikis.
- Editor/agent integrations that need fast, offline retrieval.

## Requirements

- Node.js (runtime)
- `better-sqlite3` (required for sqlite-vec HNSW indexing)

## Features

- **Hybrid Search**: Semantic vectors + BM25 + graph traversal
- **Local-Only**: No external APIs; models run via transformers.js
- **MCP Server**: Compatible with Claude Code/Cursor via Model Context Protocol
- **Markdown Native**: ATX heading parsing and heading-aware chunking
- **Entity Extraction**: Structural extraction with optional NER

## Quickstart

```bash
# Install the CLI (Node required)
npm install -g @mhingston5/raggle

# Index a directory
raggle index /path/to/markdown/files

# Exclude root-relative glob patterns (repeatable)
raggle index /path/to/markdown/files --exclude 'evidence/**' --exclude '**/drafts/**'

# Search the index
raggle search "your query here"

# (Optional) Get MCP config for your editor
raggle mcp-config
```

If you haven’t installed the CLI globally, run from source:

```bash
npm install
npm run build
node dist/cli.js index /path/to/markdown/files
node dist/cli.js search "your query here"
```

## Usage

### CLI

```bash
raggle index /path/to/markdown/files

# Exclude files or directories below the indexed root
raggle index /path/to/markdown/files --exclude 'archive/**' --exclude '*.generated.md'

raggle search "your query here"

raggle search "your query here" --mode graph --graph-seed bm25

raggle status

raggle clear

raggle mcp-config
```

Search options:
- `--mode <mode>`: `semantic|bm25|graph|hybrid` (default: `hybrid`)
- `--top <n>`: Number of results (default: `10`)
- `--no-rerank`: Disable reranking
- `--no-expand`: Disable acronym expansion
- `--graph-seed <mode>`: Seed source for graph-only search (`bm25|semantic|hybrid`, default: `bm25`)

### MCP Server

To use with Claude Code or Cursor:

```bash
# Start the MCP server
raggle mcp

# Or get the configuration for your editor
raggle mcp-config
```

Example `mcp-config` output:

```json
{
  "mcpServers": {
    "raggle": {
      "command": "npx",
      "args": ["-y", "@mhingston5/raggle", "mcp"],
      "env": { "RAGGLE_INDEX_DIR": "/Users/you/project/.raggle" }
    }
  }
}
```

### Environment Variables

All configuration uses the `RAGGLE_` prefix:

Raggle loads a `.env` file from the current working directory (if present) when starting the CLI or MCP server.

- `RAGGLE_INDEX_DIR`: Index directory (default: `<cwd>/.raggle`)
- `RAGGLE_EMBEDDING_MODEL`: Embedding model (default: `Xenova/bge-small-en-v1.5`)
- `RAGGLE_EMBEDDING_DIM`: Embedding dimension override (default: `384`)
- `RAGGLE_EXTRACT_DEPTH`: Extraction depth (`structural` or `ner`, default: `ner`)
- `RAGGLE_NER_ENTITY_TYPES`: Comma-separated entity types
- `RAGGLE_MAX_CHUNK_TOKENS`: Max chunk size (default: 512)
- `RAGGLE_CHUNK_OVERLAP`: Chunk overlap tokens (default: 50)
- `RAGGLE_FUSION_K`: RRF fusion parameter (default: 60)
- `RAGGLE_GRAPH_RRF_WEIGHT`: RRF weight for graph results (default: 1.5)
- `RAGGLE_GRAPH_MAX_HOPS`: Graph traversal depth (default: 2)
- `RAGGLE_RERANK_POOL_SIZE`: Rerank pool size (default: 20)
- `RAGGLE_RERANK_SCORE_THRESHOLD`: Rerank score threshold (default: `-8.0`)
- `RAGGLE_SEMANTIC_SCORE_FLOOR`: Minimum semantic similarity (default: `0.4`)
- `RAGGLE_READ_ONLY`: Read-only mode (`true` or `1` to enable)

## Models and Caching

The first run will download model files from Hugging Face. Subsequent runs use the local cache managed by `@xenova/transformers`.

## How It Works

1. Discover Markdown files and parse ATX headings.
2. Chunk content by section and compute embeddings.
3. Build a BM25 index and a lightweight graph (links, tags, entities).
4. At query time, run semantic + BM25 + graph search, fuse results, and optionally rerank.

## Storage

Data is stored in `<cwd>/.raggle` by default:

- `metadata.db`: SQLite database for chunks and stats
- `vectors.db`: Vector embeddings with HNSW indexing (via sqlite-vec)
- `graph.db`: Knowledge graph (nodes and edges)
- `bm25_index.json`: BM25 keyword index
- `acronyms.json`: Acronym dictionary

If you index multiple projects from the same directory, they will share the same databases. Set `RAGGLE_INDEX_DIR` to isolate per-project indexes.

### Vector Index

Vectors are indexed using [sqlite-vec](https://github.com/asg017/sqlite-vec) with HNSW (Hierarchical Navigable Small World) for efficient approximate nearest neighbor search. This provides:

- O(log n) search complexity vs O(n) brute-force
- Cosine similarity matching
- Scalable to large document collections (10k+ chunks)
- Single-file storage with ACID compliance

**Note**: HNSW indexing requires `better-sqlite3`.

```bash
# To enable HNSW indexing (recommended for large collections)
npm install better-sqlite3
```

## Architecture

```
raggle/
├── src/
│   ├── core/           # Configuration and models
│   ├── ingestion/      # File discovery and chunking
│   ├── extraction/     # Entity and relation extraction
│   ├── storage/        # SQLite-based storage
│   ├── search/         # Search engines and fusion
│   ├── cli.ts          # CLI entry point
│   └── mcp/            # MCP server
├── package.json
└── tsconfig.json
```

## Development

```bash
# Run type checker
npm run typecheck

# Run linter
npm run lint

# Run linter with auto-fix
npm run lint:fix

# Format code
npm run format
```

## Search Modes

- **semantic**: Dense vector similarity using embeddings
- **bm25**: Keyword-based BM25 scoring
- **graph**: Graph traversal from seed nodes
- **hybrid** (default): Combines all three with RRF fusion

## Example Output

```
Searching for: "NASA Apollo"
Mode: hybrid

Found 3 results:

Alpha > Details
   File: /path/to/notes/alpha.md
   Score: 0.6230
   Engines: semantic, bm25, graph
   Snippet: Alpha > Details  The National Aeronautics and Space Administration (NASA) led Apollo.
```

## License

MIT
