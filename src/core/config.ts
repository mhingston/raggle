import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtractDepth } from "./models";

export type Settings = {
  dataDir: string;
  indexDir: string;
  embeddingModel: string;
  embeddingDim: number;
  rerankerModel: string;
  rerankerMinLength: number;
  rerankerScoreThreshold: number;
  maxChunkTokens: number;
  chunkOverlapTokens: number;
  extractDepth: ExtractDepth;
  nerEntityTypes: string[];
  defaultTopK: number;
  fusionK: number;
  graphRrfWeight: number;
  rerankPoolSize: number;
  semanticScoreFloor: number;
  snippetLength: number;
  graphMaxHops: number;
  readOnly: boolean;
};

function getEnvString(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function getEnvFloat(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === "true" || value === "1";
}

function getEnvArray(key: string, defaultValue: string[]): string[] {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.split(",").map((s) => s.trim());
}

export function loadSettings(): Settings {
  const dataDir = getEnvString("RAGGLE_INDEX_DIR", join(homedir(), ".raggle"));
  const embeddingDim = getEnvNumber("RAGGLE_EMBEDDING_DIM", 384);

  return {
    dataDir,
    indexDir: dataDir,
    embeddingModel: getEnvString("RAGGLE_EMBEDDING_MODEL", "Xenova/bge-small-en-v1.5"),
    embeddingDim,
    rerankerModel: "cross-encoder/ms-marco-MiniLM-L-6-v2",
    rerankerMinLength: 20,
    rerankerScoreThreshold: getEnvFloat("RAGGLE_RERANK_SCORE_THRESHOLD", -8.0),
    maxChunkTokens: getEnvNumber("RAGGLE_MAX_CHUNK_TOKENS", 512),
    chunkOverlapTokens: getEnvNumber("RAGGLE_CHUNK_OVERLAP", 50),
    extractDepth: getEnvString("RAGGLE_EXTRACT_DEPTH", "ner") as ExtractDepth,
    nerEntityTypes: getEnvArray("RAGGLE_NER_ENTITY_TYPES", [
      "person",
      "organization",
      "technology",
      "concept",
      "location",
      "object",
      "activity",
      "date_time",
    ]),
    defaultTopK: 10,
    fusionK: getEnvNumber("RAGGLE_FUSION_K", 60),
    graphRrfWeight: getEnvFloat("RAGGLE_GRAPH_RRF_WEIGHT", 1.5),
    rerankPoolSize: getEnvNumber("RAGGLE_RERANK_POOL_SIZE", 20),
    semanticScoreFloor: getEnvFloat("RAGGLE_SEMANTIC_SCORE_FLOOR", 0.4),
    snippetLength: 300,
    graphMaxHops: getEnvNumber("RAGGLE_GRAPH_MAX_HOPS", 2),
    readOnly: getEnvBoolean("RAGGLE_READ_ONLY", false),
  };
}

let cachedSettings: Settings | null = null;

export function getSettings(): Settings {
  if (!cachedSettings) {
    cachedSettings = loadSettings();
  }
  return cachedSettings;
}

export function resetSettings(): void {
  cachedSettings = null;
}

/**
 * Check if read-only mode is enabled.
 * Used to prevent writes when RAGGLE_READ_ONLY is set.
 */
export function isReadOnly(): boolean {
  return getSettings().readOnly;
}

/**
 * Assert that the system is not in read-only mode.
 * Throws an error if read-only mode is enabled.
 */
export function assertNotReadOnly(operation: string): void {
  if (isReadOnly()) {
    throw new Error(
      `Cannot perform operation "${operation}": RAGGLE_READ_ONLY is enabled. ` +
        `Disable read-only mode to perform write operations.`
    );
  }
}
