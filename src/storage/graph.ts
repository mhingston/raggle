import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { assertNotReadOnly, getSettings, isReadOnly } from "../core/config";

export type NodeType = "file" | "section" | "entity" | "tag";
export type EdgeType =
  | "LINKS_TO"
  | "HAS_TAG"
  | "PARENT_OF"
  | "MENTIONS"
  | "CO_OCCURS"
  | "HAS_FRONTMATTER"
  | "CONTAINS";

export interface GraphStore {
  addFileNode(filePath: string, title: string, checksum: string): void;
  addSectionNode(
    chunkId: string,
    heading: string,
    level: number,
    filePath: string,
    textPreview: string
  ): void;
  addEntityNode(name: string, entityType: string, source: string): void;
  addTagNode(name: string): void;
  addEdge(
    sourceId: string,
    targetId: string,
    relationType: EdgeType,
    weight: number,
    chunkId?: string
  ): void;
  getNeighbors(nodeId: string, maxHops: number): Array<[string, string, number]>;
  deleteEdgesByChunkIds(chunkIds: string[]): void;
  deleteNodes(nodeIds: string[]): void;
  deleteAll(): void;
  nodeCount(): number;
  nodeCountByType(type: NodeType): number;
  edgeCount(): number;
}

export class SQLiteGraphStore implements GraphStore {
  private db: Database;

  constructor(dbPath?: string) {
    const settings = getSettings();
    const indexDir = dbPath ?? settings.indexDir;
    const dbFile = join(indexDir, "graph.db");
    if (isReadOnly()) {
      if (!existsSync(indexDir)) {
        throw new Error(`Index directory not found in read-only mode: ${indexDir}`);
      }
      if (!existsSync(dbFile)) {
        throw new Error(`Graph database not found in read-only mode: ${dbFile}`);
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
      CREATE TABLE IF NOT EXISTS nodes (
        node_id TEXT PRIMARY KEY,
        node_type TEXT NOT NULL,
        name TEXT NOT NULL,
        properties TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(node_type);

      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        weight REAL NOT NULL,
        UNIQUE(source_id, target_id, relation_type)
      );

      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);

      CREATE TABLE IF NOT EXISTS edge_provenance (
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        PRIMARY KEY (source_id, target_id, relation_type, chunk_id)
      );

      CREATE INDEX IF NOT EXISTS idx_edge_provenance_chunk ON edge_provenance(chunk_id);
    `);
  }

  private validateSchema(): void {
    const rows = this.db
      .query(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as Array<{ name: string }>;
    const tables = new Set(rows.map((r) => r.name));
    const required = ["nodes", "edges", "edge_provenance"];
    for (const table of required) {
      if (!tables.has(table)) {
        throw new Error(`Graph table missing in read-only mode: ${table}`);
      }
    }
  }

  private getNodeId(type: NodeType, identifier: string): string {
    return `${type}:${identifier}`;
  }

  addFileNode(filePath: string, title: string, checksum: string): void {
    assertNotReadOnly("addFileNode");
    const nodeId = this.getNodeId("file", filePath);
    this.db
      .query(
        `
      INSERT OR REPLACE INTO nodes (node_id, node_type, name, properties)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(nodeId, "file", title, JSON.stringify({ path: filePath, checksum }));
  }

  addSectionNode(
    chunkId: string,
    heading: string,
    level: number,
    filePath: string,
    textPreview: string
  ): void {
    assertNotReadOnly("addSectionNode");
    const nodeId = this.getNodeId("section", chunkId);
    this.db
      .query(
        `
      INSERT OR REPLACE INTO nodes (node_id, node_type, name, properties)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(
        nodeId,
        "section",
        heading,
        JSON.stringify({
          chunkId,
          level,
          filePath,
          textPreview: textPreview.slice(0, 200),
        })
      );

    // Add edge from file to section
    const fileNodeId = this.getNodeId("file", filePath);
    this.addEdge(fileNodeId, nodeId, "CONTAINS", 1.0);
  }

  addEntityNode(name: string, entityType: string, source: string): void {
    assertNotReadOnly("addEntityNode");
    const nodeId = this.getNodeId("entity", `${entityType}:${name}`);
    this.db
      .query(
        `
      INSERT OR REPLACE INTO nodes (node_id, node_type, name, properties)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(nodeId, "entity", name, JSON.stringify({ type: entityType, source }));
  }

  addTagNode(name: string): void {
    assertNotReadOnly("addTagNode");
    const nodeId = this.getNodeId("tag", name);
    this.db
      .query(
        `
      INSERT OR REPLACE INTO nodes (node_id, node_type, name, properties)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(nodeId, "tag", name, "{}");
  }

  addEdge(
    sourceId: string,
    targetId: string,
    relationType: EdgeType,
    weight: number,
    chunkId?: string
  ): void {
    assertNotReadOnly("addEdge");
    this.db
      .query(
        `
      INSERT OR REPLACE INTO edges (source_id, target_id, relation_type, weight)
      VALUES (?, ?, ?, ?)
    `
      )
      .run(sourceId, targetId, relationType, weight);

    if (relationType === "CO_OCCURS" && chunkId) {
      this.db
        .query(
          `
        INSERT OR REPLACE INTO edge_provenance
        (source_id, target_id, relation_type, chunk_id)
        VALUES (?, ?, ?, ?)
      `
        )
        .run(sourceId, targetId, relationType, chunkId);
    }
  }

  getNeighbors(nodeId: string, maxHops: number): Array<[string, string, number]> {
    const results: Array<[string, string, number]> = [];
    const visited = new Set<string>();
    let currentLevel = new Set<string>([nodeId]);

    for (let hop = 0; hop < maxHops && currentLevel.size > 0; hop++) {
      const nextLevel = new Set<string>();

      for (const currentNode of currentLevel) {
        if (visited.has(currentNode)) continue;
        visited.add(currentNode);

        const rows = this.db
          .query(
            `
          SELECT
            CASE WHEN source_id = ? THEN target_id ELSE source_id END AS neighbor_id,
            relation_type,
            weight
          FROM edges
          WHERE source_id = ? OR target_id = ?
        `
          )
          .all(currentNode, currentNode, currentNode) as Array<{
          neighbor_id: string;
          relation_type: string;
          weight: number;
        }>;

        for (const row of rows) {
          const neighborId = row.neighbor_id;

          results.push([neighborId, row.relation_type, row.weight]);

          if (!visited.has(neighborId)) {
            nextLevel.add(neighborId);
          }
        }
      }

      currentLevel = nextLevel;
    }

    return results;
  }

  deleteEdgesByChunkIds(chunkIds: string[]): void {
    if (chunkIds.length === 0) return;
    assertNotReadOnly("deleteEdgesByChunkIds");
    const placeholders = chunkIds.map(() => "?").join(",");
    const impacted = this.db
      .query(
        `
      SELECT DISTINCT source_id, target_id, relation_type
      FROM edge_provenance
      WHERE chunk_id IN (${placeholders})
    `
      )
      .all(...chunkIds) as Array<{
      source_id: string;
      target_id: string;
      relation_type: string;
    }>;

    this.db
      .query(`DELETE FROM edge_provenance WHERE chunk_id IN (${placeholders})`)
      .run(...chunkIds);

    for (const edge of impacted) {
      const remaining = this.db
        .query(
          `
        SELECT 1 FROM edge_provenance
        WHERE source_id = ? AND target_id = ? AND relation_type = ?
        LIMIT 1
      `
        )
        .get(edge.source_id, edge.target_id, edge.relation_type);

      if (!remaining) {
        this.db
          .query(
            `
          DELETE FROM edges
          WHERE source_id = ? AND target_id = ? AND relation_type = ?
        `
          )
          .run(edge.source_id, edge.target_id, edge.relation_type);
      }
    }
  }

  deleteNodes(nodeIds: string[]): void {
    if (nodeIds.length === 0) return;
    assertNotReadOnly("deleteNodes");
    const placeholders = nodeIds.map(() => "?").join(",");
    this.db
      .query(
        `DELETE FROM edges WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`
      )
      .run(...nodeIds, ...nodeIds);
    this.db.query(`DELETE FROM nodes WHERE node_id IN (${placeholders})`).run(...nodeIds);
  }

  deleteAll(): void {
    assertNotReadOnly("deleteAll");
    this.db.exec(`
      DELETE FROM nodes;
      DELETE FROM edges;
      DELETE FROM edge_provenance;
    `);
  }

  nodeCount(): number {
    const result = this.db.query("SELECT COUNT(*) as count FROM nodes").get() as { count: number };
    return result.count;
  }

  nodeCountByType(type: NodeType): number {
    const result = this.db
      .query("SELECT COUNT(*) as count FROM nodes WHERE node_type = ?")
      .get(type) as { count: number };
    return result.count;
  }

  edgeCount(): number {
    const result = this.db.query("SELECT COUNT(*) as count FROM edges").get() as { count: number };
    return result.count;
  }

  close(): void {
    this.db.close();
  }
}

let globalStore: SQLiteGraphStore | null = null;

export function getGraphStore(): GraphStore {
  if (!globalStore) {
    globalStore = new SQLiteGraphStore();
  }
  return globalStore;
}

export function resetGraphStore(): void {
  globalStore?.close();
  globalStore = null;
}
