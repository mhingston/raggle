export type FileInfo = {
  path: string;
  title: string;
  lastModified: Date;
  sizeBytes: number;
  checksum: string;
};

export type Chunk = {
  chunkId: string;
  filePath: string;
  headingHierarchy: string[];
  level: number;
  text: string;
  chunkIndex: number;
  charOffset: number;
};

export type Entity = {
  name: string;
  type: string;
  source: "structural" | "ner" | "keyterm";
  chunkIds: string[];
};

export type Relation = {
  sourceId: string;
  targetId: string;
  relationType: string;
  weight: number;
  properties?: Record<string, string>;
};

export type ExtractionResult = {
  entities: Entity[];
  relations: Relation[];
};

export type SearchResult = {
  chunkId: string;
  filePath: string;
  headingPath: string;
  snippet: string;
  fusedScore: number;
  semanticScore?: number;
  bm25Score?: number;
  graphScore?: number;
  matchedEngines: string[];
};

export type IndexStats = {
  totalFiles: number;
  totalChunks: number;
  totalEntities: number;
  totalEdges: number;
  lastIndexed?: Date;
};

export type SearchMode = "semantic" | "bm25" | "graph" | "hybrid";

export type ExtractDepth = "structural" | "ner";
