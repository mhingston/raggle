import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertNotReadOnly, getSettings, isReadOnly } from "../core/config";
import type { Chunk, FileInfo, IndexStats } from "../core/models";

export interface MetadataStore {
  saveFiles(files: FileInfo[]): void;
  getFiles(): FileInfo[];
  getFileByPath(filePath: string): FileInfo | null;
  deleteFiles(filePaths: string[]): void;
  saveChunks(chunks: Chunk[]): void;
  getChunk(chunkId: string): Chunk | null;
  getChunks(chunkIds: string[]): Chunk[];
  getAllChunks(): Chunk[];
  getChunkIdsByFile(filePath: string): string[];
  deleteChunksByFile(filePath: string): void;
  saveStats(stats: IndexStats): void;
  getStats(): IndexStats | null;
  deleteAll(): void;
}

export class SQLiteMetadataStore implements MetadataStore {
  private db: Database;

  constructor(dbPath?: string) {
    const settings = getSettings();
    const indexDir = dbPath ?? settings.indexDir;
    const dbFile = join(indexDir, "metadata.db");
    if (isReadOnly()) {
      if (!existsSync(indexDir)) {
        throw new Error(`Index directory not found in read-only mode: ${indexDir}`);
      }
      if (!existsSync(dbFile)) {
        throw new Error(`Metadata database not found in read-only mode: ${dbFile}`);
      }
    } else {
      mkdirSync(indexDir, { recursive: true });
    }
    this.db = new Database(dbFile);
    if (isReadOnly()) {
      this.validateSchema();
    } else {
      this.initializeTables();
    }
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        chunk_id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        heading_hierarchy TEXT NOT NULL,
        level INTEGER NOT NULL,
        text TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        char_offset INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_file_path ON chunks(file_path);

      CREATE TABLE IF NOT EXISTS files (
        file_path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        last_modified TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        checksum TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_files_checksum ON files(checksum);

      CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        total_files INTEGER NOT NULL,
        total_chunks INTEGER NOT NULL,
        total_entities INTEGER NOT NULL,
        total_edges INTEGER NOT NULL,
        last_indexed TEXT
      );
    `);
  }

  private validateSchema(): void {
    const rows = this.db
      .query(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as Array<{ name: string }>;
    const tables = new Set(rows.map((r) => r.name));
    const required = ["chunks", "files", "stats"];
    for (const table of required) {
      if (!tables.has(table)) {
        throw new Error(`Metadata table missing in read-only mode: ${table}`);
      }
    }
  }

  saveChunks(chunks: Chunk[]): void {
    assertNotReadOnly("saveChunks");
    const insert = this.db.query(`
      INSERT OR REPLACE INTO chunks 
      (chunk_id, file_path, heading_hierarchy, level, text, chunk_index, char_offset)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const chunk of chunks) {
      insert.run(
        chunk.chunkId,
        chunk.filePath,
        JSON.stringify(chunk.headingHierarchy),
        chunk.level,
        chunk.text,
        chunk.chunkIndex,
        chunk.charOffset
      );
    }
  }

  saveFiles(files: FileInfo[]): void {
    assertNotReadOnly("saveFiles");
    const insert = this.db.query(`
      INSERT OR REPLACE INTO files
      (file_path, title, last_modified, size_bytes, checksum)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const file of files) {
      insert.run(
        file.path,
        file.title,
        file.lastModified.toISOString(),
        file.sizeBytes,
        file.checksum
      );
    }
  }

  getFiles(): FileInfo[] {
    const rows = this.db
      .query(
        `
      SELECT file_path, title, last_modified, size_bytes, checksum
      FROM files
    `
      )
      .all() as Array<{
      file_path: string;
      title: string;
      last_modified: string;
      size_bytes: number;
      checksum: string;
    }>;

    return rows.map((row) => ({
      path: row.file_path,
      title: row.title,
      lastModified: new Date(row.last_modified),
      sizeBytes: row.size_bytes,
      checksum: row.checksum,
    }));
  }

  getFileByPath(filePath: string): FileInfo | null {
    const row = this.db
      .query(
        `
      SELECT file_path, title, last_modified, size_bytes, checksum
      FROM files WHERE file_path = ?
    `
      )
      .get(filePath) as
      | {
          file_path: string;
          title: string;
          last_modified: string;
          size_bytes: number;
          checksum: string;
        }
      | undefined;

    if (!row) return null;

    return {
      path: row.file_path,
      title: row.title,
      lastModified: new Date(row.last_modified),
      sizeBytes: row.size_bytes,
      checksum: row.checksum,
    };
  }

  deleteFiles(filePaths: string[]): void {
    if (filePaths.length === 0) return;
    assertNotReadOnly("deleteFiles");
    const placeholders = filePaths.map(() => "?").join(",");
    this.db.query(`DELETE FROM files WHERE file_path IN (${placeholders})`).run(...filePaths);
  }

  getChunk(chunkId: string): Chunk | null {
    const row = this.db
      .query(
        `
      SELECT chunk_id, file_path, heading_hierarchy, level, text, chunk_index, char_offset
      FROM chunks WHERE chunk_id = ?
    `
      )
      .get(chunkId) as
      | {
          chunk_id: string;
          file_path: string;
          heading_hierarchy: string;
          level: number;
          text: string;
          chunk_index: number;
          char_offset: number;
        }
      | undefined;

    if (!row) return null;

    return {
      chunkId: row.chunk_id,
      filePath: row.file_path,
      headingHierarchy: JSON.parse(row.heading_hierarchy),
      level: row.level,
      text: row.text,
      chunkIndex: row.chunk_index,
      charOffset: row.char_offset,
    };
  }

  getChunks(chunkIds: string[]): Chunk[] {
    if (chunkIds.length === 0) return [];

    const placeholders = chunkIds.map(() => "?").join(",");
    const rows = this.db
      .query(
        `
      SELECT chunk_id, file_path, heading_hierarchy, level, text, chunk_index, char_offset
      FROM chunks WHERE chunk_id IN (${placeholders})
    `
      )
      .all(...chunkIds) as Array<{
      chunk_id: string;
      file_path: string;
      heading_hierarchy: string;
      level: number;
      text: string;
      chunk_index: number;
      char_offset: number;
    }>;

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      filePath: row.file_path,
      headingHierarchy: JSON.parse(row.heading_hierarchy),
      level: row.level,
      text: row.text,
      chunkIndex: row.chunk_index,
      charOffset: row.char_offset,
    }));
  }

  getAllChunks(): Chunk[] {
    const rows = this.db
      .query(
        `
      SELECT chunk_id, file_path, heading_hierarchy, level, text, chunk_index, char_offset
      FROM chunks
    `
      )
      .all() as Array<{
      chunk_id: string;
      file_path: string;
      heading_hierarchy: string;
      level: number;
      text: string;
      chunk_index: number;
      char_offset: number;
    }>;

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      filePath: row.file_path,
      headingHierarchy: JSON.parse(row.heading_hierarchy),
      level: row.level,
      text: row.text,
      chunkIndex: row.chunk_index,
      charOffset: row.char_offset,
    }));
  }

  getChunkIdsByFile(filePath: string): string[] {
    const rows = this.db
      .query(
        `
      SELECT chunk_id FROM chunks WHERE file_path = ?
    `
      )
      .all(filePath) as Array<{ chunk_id: string }>;
    return rows.map((row) => row.chunk_id);
  }

  deleteChunksByFile(filePath: string): void {
    assertNotReadOnly("deleteChunksByFile");
    this.db.query("DELETE FROM chunks WHERE file_path = ?").run(filePath);
  }

  saveStats(stats: IndexStats): void {
    assertNotReadOnly("saveStats");
    this.db
      .query(
        `
      INSERT OR REPLACE INTO stats 
      (id, total_files, total_chunks, total_entities, total_edges, last_indexed)
      VALUES (1, ?, ?, ?, ?, ?)
    `
      )
      .run(
        stats.totalFiles,
        stats.totalChunks,
        stats.totalEntities,
        stats.totalEdges,
        stats.lastIndexed?.toISOString() ?? null
      );
  }

  getStats(): IndexStats | null {
    const row = this.db
      .query(
        `
      SELECT total_files, total_chunks, total_entities, total_edges, last_indexed
      FROM stats WHERE id = 1
    `
      )
      .get() as
      | {
          total_files: number;
          total_chunks: number;
          total_entities: number;
          total_edges: number;
          last_indexed: string | null;
        }
      | undefined;

    if (!row) return null;

    return {
      totalFiles: row.total_files,
      totalChunks: row.total_chunks,
      totalEntities: row.total_entities,
      totalEdges: row.total_edges,
      lastIndexed: row.last_indexed ? new Date(row.last_indexed) : undefined,
    };
  }

  deleteAll(): void {
    assertNotReadOnly("deleteAll");
    this.db.exec(`
      DELETE FROM chunks;
      DELETE FROM files;
      DELETE FROM stats;
    `);
  }

  close(): void {
    this.db.close();
  }
}

let globalStore: SQLiteMetadataStore | null = null;

export function getMetadataStore(): MetadataStore {
  if (!globalStore) {
    globalStore = new SQLiteMetadataStore();
  }
  return globalStore;
}

export function resetMetadataStore(): void {
  globalStore?.close();
  globalStore = null;
}
