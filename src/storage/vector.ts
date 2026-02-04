import { Database as BunDatabase } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as sqliteVec from "sqlite-vec";
import { assertNotReadOnly, getSettings, isReadOnly } from "../core/config";
import type { Chunk } from "../core/models";

export interface VectorStore {
  addChunks(chunks: Chunk[], embeddings: number[][]): void;
  search(queryEmbedding: number[], topK: number): Array<[string, number]>;
  deleteChunks(chunkIds: string[]): void;
  deleteAll(): void;
  count(): number;
}

// Type for SQLite database (either bun:sqlite or better-sqlite3)
type Database = BunDatabase | import("better-sqlite3").Database;

/**
 * Brute-force vector store using cosine similarity.
 *
 * Time complexity: O(n) for search
 * Space complexity: O(n*d) where d is embedding dimension
 *
 * Suitable for small collections (< 1000 chunks).
 * For larger collections, use SQLiteVecVectorStore with HNSW indexing.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

export class BruteForceVectorStore implements VectorStore {
  private db: BunDatabase;
  private cache: Map<string, number[]> = new Map();
  private needsReload: boolean = true;

  constructor(dbPath?: string) {
    const settings = getSettings();
    const indexDir = dbPath ?? settings.indexDir;
    const dbFile = join(indexDir, "vectors.db");
    if (isReadOnly()) {
      if (!existsSync(indexDir)) {
        throw new Error(`Index directory not found in read-only mode: ${indexDir}`);
      }
      if (!existsSync(dbFile)) {
        throw new Error(`Vector database not found in read-only mode: ${dbFile}`);
      }
    } else {
      mkdirSync(indexDir, { recursive: true });
    }
    this.db = new BunDatabase(dbFile);
    if (isReadOnly()) {
      this.validateSchema();
    } else {
      this.initializeTables();
    }
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        chunk_id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL
      );
    `);
  }

  private validateSchema(): void {
    const rows = this.db
      .query(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as Array<{ name: string }>;
    const tables = new Set(rows.map((r) => r.name));
    if (!tables.has("vectors")) {
      throw new Error(`Vector table missing in read-only mode: vectors`);
    }
  }

  private loadCache(): void {
    if (!this.needsReload) return;

    this.cache.clear();
    const rows = this.db.query("SELECT chunk_id, embedding FROM vectors").all() as Array<{
      chunk_id: string;
      embedding: Buffer;
    }>;

    for (const row of rows) {
      const embedding = new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
      );
      this.cache.set(row.chunk_id, Array.from(embedding));
    }

    this.needsReload = false;
  }

  addChunks(chunks: Chunk[], embeddings: number[][]): void {
    assertNotReadOnly("addChunks");
    const insert = this.db.query(
      "INSERT OR REPLACE INTO vectors (chunk_id, embedding) VALUES (?, ?)"
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];
      if (!chunk || !embedding) continue;

      const buffer = Buffer.from(new Float32Array(embedding).buffer);
      insert.run(chunk.chunkId, buffer);
      this.cache.set(chunk.chunkId, embedding);
    }

    this.needsReload = false;
  }

  search(queryEmbedding: number[], topK: number): Array<[string, number]> {
    this.loadCache();

    const settings = getSettings();
    const results: Array<[string, number]> = [];

    for (const [chunkId, embedding] of this.cache.entries()) {
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      if (similarity >= settings.semanticScoreFloor) {
        results.push([chunkId, similarity]);
      }
    }

    results.sort((a, b) => b[1] - a[1]);
    return results.slice(0, topK);
  }

  deleteChunks(chunkIds: string[]): void {
    if (chunkIds.length === 0) return;
    assertNotReadOnly("deleteChunks");
    const placeholders = chunkIds.map(() => "?").join(",");
    this.db.query(`DELETE FROM vectors WHERE chunk_id IN (${placeholders})`).run(...chunkIds);
    for (const chunkId of chunkIds) {
      this.cache.delete(chunkId);
    }
  }

  deleteAll(): void {
    assertNotReadOnly("deleteAll");
    this.db.exec("DELETE FROM vectors");
    this.cache.clear();
    this.needsReload = true;
  }

  count(): number {
    const result = this.db.query("SELECT COUNT(*) as count FROM vectors").get() as {
      count: number;
    };
    return result.count;
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Vector store implementation using sqlite-vec with HNSW indexing.
 *
 * sqlite-vec provides:
 * - HNSW (Hierarchical Navigable Small World) for approximate nearest neighbor search
 * - Virtual tables for vector storage
 * - Efficient cosine similarity search
 * - ACID compliance with SQLite
 *
 * Benefits over brute-force:
 * - O(log n) search complexity vs O(n)
 * - Scales to large document collections (10k+ chunks)
 * - No in-memory cache required
 * - Persisted HNSW index survives restarts
 */
export class SQLiteVecVectorStore implements VectorStore {
  private db: Database;
  private dimension: number;
  private tableName = "vec_chunks";

  constructor(dbPath?: string, dimension?: number) {
    const settings = getSettings();
    const indexDir = dbPath ?? settings.indexDir;
    this.dimension = dimension ?? settings.embeddingDim;

    const dbFile = join(indexDir, "vectors.db");
    if (isReadOnly()) {
      if (!existsSync(indexDir)) {
        throw new Error(`Index directory not found in read-only mode: ${indexDir}`);
      }
      if (!existsSync(dbFile)) {
        throw new Error(`Vector database not found in read-only mode: ${dbFile}`);
      }
    } else {
      mkdirSync(indexDir, { recursive: true });
    }

    // Try to use better-sqlite3 for extension support, fall back to bun:sqlite
    let db: Database;
    try {
      const BetterSQLite3 = require("better-sqlite3");
      db = new BetterSQLite3(dbFile);
    } catch {
      if (isReadOnly()) {
        throw new Error(
          "Read-only sqlite-vec index requires better-sqlite3. " +
            "Install better-sqlite3 or reindex to use brute-force vectors."
        );
      }
      // better-sqlite3 not available, try bun:sqlite (won't support extensions)
      db = new BunDatabase(dbFile);
    }
    this.db = db;

    // Load sqlite-vec extension
    sqliteVec.load(this.db);

    if (isReadOnly()) {
      this.validateSchema();
    } else {
      this.initializeTables();
    }
  }

  private initializeTables(): void {
    // Create the vector virtual table with HNSW index
    // chunk_id is stored as the rowid for efficient lookups
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${this.tableName} USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding FLOAT[${this.dimension}] distance_metric=cosine
      );
    `);

    // Create metadata table to store chunk_id to rowid mapping
    // This allows us to efficiently delete by chunk_id
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vec_metadata (
        chunk_id TEXT PRIMARY KEY,
        rowid INTEGER NOT NULL
      );
    `);

    // Create index for faster metadata lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_vec_metadata_rowid 
      ON vec_metadata(rowid);
    `);
  }

  private validateSchema(): void {
    const rows = this.db
      .query(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as Array<{ name: string }>;
    const tables = new Set(rows.map((r) => r.name));
    const required = [this.tableName, "vec_metadata"];
    for (const table of required) {
      if (!tables.has(table)) {
        throw new Error(`Vector table missing in read-only mode: ${table}`);
      }
    }
  }

  addChunks(chunks: Chunk[], embeddings: number[][]): void {
    if (chunks.length === 0) return;
    assertNotReadOnly("addChunks");

    const insertVectors = this.db.prepare(`
      INSERT INTO ${this.tableName}(chunk_id, embedding)
      VALUES (?, vec_f32(?))
    `);

    const insertMetadata = this.db.prepare(`
      INSERT OR REPLACE INTO vec_metadata (chunk_id, rowid)
      VALUES (?, ?)
    `);

    // Use transaction for batch insert
    const transaction = this.db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = embeddings[i];

        if (!chunk || !embedding) continue;

        // Validate embedding dimension
        if (embedding.length !== this.dimension) {
          console.warn(
            `Skipping chunk ${chunk.chunkId}: expected ${this.dimension} dimensions, got ${embedding.length}`
          );
          continue;
        }

        try {
          // Insert into virtual table and get rowid
          const result = insertVectors.run(chunk.chunkId, JSON.stringify(embedding));
          const rowid = result.lastInsertRowid;

          // Store mapping for deletion
          insertMetadata.run(chunk.chunkId, rowid);
        } catch (error) {
          console.warn(`Failed to insert chunk ${chunk.chunkId}:`, error);
        }
      }
    });

    transaction();
  }

  search(queryEmbedding: number[], topK: number): Array<[string, number]> {
    const settings = getSettings();

    // Validate query embedding
    if (queryEmbedding.length !== this.dimension) {
      console.warn(
        `Query embedding has ${queryEmbedding.length} dimensions, expected ${this.dimension}`
      );
      return [];
    }

    // sqlite-vec cosine distance returns values from 0 (identical) to 2 (opposite)
    // Convert to similarity: similarity = 1 - (distance / 2)
    // Note: We use a subquery because SQLite doesn't allow SELECT aliases in WHERE clauses
    const results = this.db
      .query(
        `
        SELECT chunk_id, similarity FROM (
          SELECT 
            chunk_id,
            distance as raw_distance,
            (1 - (distance / 2.0)) as similarity
          FROM ${this.tableName}
          WHERE embedding MATCH vec_f32(?)
          AND k = ?
        )
        WHERE similarity >= ?
        ORDER BY similarity DESC
      `
      )
      .all(JSON.stringify(queryEmbedding), topK * 2, settings.semanticScoreFloor) as Array<{
      chunk_id: string;
      similarity: number;
    }>;

    // Filter by semantic score floor and return topK
    return results
      .filter((row) => row.similarity >= settings.semanticScoreFloor)
      .slice(0, topK)
      .map((row) => [row.chunk_id, row.similarity]);
  }

  deleteChunks(chunkIds: string[]): void {
    if (chunkIds.length === 0) return;
    assertNotReadOnly("deleteChunks");

    // Get rowids for the chunk_ids
    const placeholders = chunkIds.map(() => "?").join(",");
    const rowids = this.db
      .query(`SELECT rowid FROM vec_metadata WHERE chunk_id IN (${placeholders})`)
      .all(...chunkIds) as Array<{ rowid: number }>;

    if (rowids.length === 0) return;

    // Delete from virtual table using rowids
    const rowidPlaceholders = rowids.map(() => "?").join(",");
    this.db
      .query(`DELETE FROM ${this.tableName} WHERE rowid IN (${rowidPlaceholders})`)
      .run(...rowids.map((r) => r.rowid));

    // Delete from metadata table
    this.db.query(`DELETE FROM vec_metadata WHERE chunk_id IN (${placeholders})`).run(...chunkIds);
  }

  deleteAll(): void {
    assertNotReadOnly("deleteAll");
    // Drop and recreate the virtual table
    this.db.exec(`DROP TABLE IF EXISTS ${this.tableName}`);
    this.db.exec(`DROP TABLE IF EXISTS vec_metadata`);
    this.initializeTables();
  }

  count(): number {
    const result = this.db.query(`SELECT COUNT(*) as count FROM ${this.tableName}`).get() as {
      count: number;
    };
    return result.count;
  }

  getDimension(): number {
    return this.dimension;
  }

  /**
   * Get statistics about the vector index
   */
  getStats(): {
    count: number;
    dimension: number;
    indexSize: number;
  } {
    const count = this.count();

    // Get index size from SQLite
    const pageCount = this.db.query("PRAGMA page_count").get() as { page_count: number };
    const pageSize = this.db.query("PRAGMA page_size").get() as { page_size: number };
    const indexSize = (pageCount.page_count * pageSize.page_size) / (1024 * 1024); // MB

    return {
      count,
      dimension: this.dimension,
      indexSize: Math.round(indexSize * 100) / 100,
    };
  }

  close(): void {
    this.db.close();
  }
}

let globalStore: VectorStore | null = null;
let globalStoreDimension: number | null = null;

function detectVectorStoreType(dbFile: string): "sqlite-vec" | "brute" | "unknown" {
  if (!existsSync(dbFile)) return "unknown";
  const db = new BunDatabase(dbFile);
  try {
    const rows = db
      .query(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as Array<{ name: string }>;
    const tables = new Set(rows.map((r) => r.name));
    if (tables.has("vec_chunks")) return "sqlite-vec";
    if (tables.has("vectors")) return "brute";
    return "unknown";
  } finally {
    db.close();
  }
}

export function getVectorStore(dimension?: number): VectorStore {
  if (!globalStore) {
    const settings = getSettings();
    const effectiveDim = dimension ?? settings.embeddingDim;
    if (isReadOnly()) {
      const dbFile = join(settings.indexDir, "vectors.db");
      const storeType = detectVectorStoreType(dbFile);
      if (storeType === "sqlite-vec") {
        globalStore = new SQLiteVecVectorStore(undefined, effectiveDim);
      } else if (storeType === "brute") {
        globalStore = new BruteForceVectorStore();
      } else {
        throw new Error(`Vector index not found or unrecognized in read-only mode: ${dbFile}`);
      }
    } else {
      // Try sqlite-vec first for HNSW indexing, fall back to brute-force if it fails
      // (e.g., when using bun:sqlite which doesn't support dynamic extensions)
      try {
        globalStore = new SQLiteVecVectorStore(undefined, effectiveDim);
      } catch (_error) {
        console.warn(
          "sqlite-vec not available (dynamic extensions not supported), falling back to brute-force vector search"
        );
        globalStore = new BruteForceVectorStore();
      }
    }
    globalStoreDimension = dimension ?? settings.embeddingDim;
    return globalStore;
  }
  if (dimension && globalStoreDimension && dimension !== globalStoreDimension) {
    console.warn(
      `Embedding dimension changed from ${globalStoreDimension} to ${dimension}. Reinitializing vector store.`
    );
    if (globalStore && "close" in globalStore) {
      (globalStore as { close: () => void }).close();
    }
    try {
      globalStore = new SQLiteVecVectorStore(undefined, dimension);
    } catch (_error) {
      console.warn(
        "sqlite-vec not available (dynamic extensions not supported), falling back to brute-force vector search"
      );
      globalStore = new BruteForceVectorStore();
    }
    globalStoreDimension = dimension;
  }
  return globalStore;
}

export function resetVectorStore(): void {
  globalStore?.close();
  globalStore = null;
  globalStoreDimension = null;
}
