import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getSettings } from "../core/config";
import type { Chunk } from "../core/models";
import { tokenize } from "../utils/text";

interface BM25Document {
  id: string;
  tokens: string[];
  tokenFreq: Map<string, number>;
  length: number;
}

interface BM25Index {
  documents: Map<string, BM25Document>;
  docCount: number;
  avgDocLength: number;
  idf: Map<string, number>;
}

// BM25 parameters
const K1 = 1.5;
const B = 0.75;

function calculateIDF(term: string, docs: Map<string, BM25Document>): number {
  const docFreq = Array.from(docs.values()).filter((doc) => doc.tokenFreq.has(term)).length;

  if (docFreq === 0) return 0;

  return Math.log((docs.size - docFreq + 0.5) / (docFreq + 0.5) + 1);
}

export function buildBM25Index(chunks: Chunk[]): BM25Index {
  const documents = new Map<string, BM25Document>();
  let totalLength = 0;

  for (const chunk of chunks) {
    const tokens = tokenize(chunk.text);
    const tokenFreq = new Map<string, number>();

    for (const token of tokens) {
      tokenFreq.set(token, (tokenFreq.get(token) || 0) + 1);
    }

    documents.set(chunk.chunkId, {
      id: chunk.chunkId,
      tokens,
      tokenFreq,
      length: tokens.length,
    });

    totalLength += tokens.length;
  }

  const avgDocLength = documents.size > 0 ? totalLength / documents.size : 0;

  // Pre-calculate IDF for all terms
  const idf = new Map<string, number>();
  const allTerms = new Set<string>();

  for (const doc of documents.values()) {
    for (const term of doc.tokenFreq.keys()) {
      allTerms.add(term);
    }
  }

  for (const term of allTerms) {
    idf.set(term, calculateIDF(term, documents));
  }

  return {
    documents,
    docCount: documents.size,
    avgDocLength,
    idf,
  };
}

function calculateBM25Score(queryTokens: string[], doc: BM25Document, index: BM25Index): number {
  let score = 0;

  for (const token of queryTokens) {
    const tf = doc.tokenFreq.get(token) || 0;
    const idf = index.idf.get(token) || 0;

    if (tf === 0 || idf === 0) continue;

    const numerator = tf * (K1 + 1);
    const denominator = tf + K1 * (1 - B + B * (doc.length / index.avgDocLength));

    score += idf * (numerator / denominator);
  }

  return score;
}

export function bm25Search(query: string, index: BM25Index, topK: number): Array<[string, number]> {
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0 || index.docCount === 0) {
    return [];
  }

  const scores: Array<[string, number]> = [];

  for (const [docId, doc] of index.documents) {
    const score = calculateBM25Score(queryTokens, doc, index);
    if (score > 0) {
      scores.push([docId, score]);
    }
  }

  scores.sort((a, b) => b[1] - a[1]);
  return scores.slice(0, topK);
}

export function saveBM25Index(index: BM25Index, filePath: string): void {
  const serialized = {
    docCount: index.docCount,
    avgDocLength: index.avgDocLength,
    documents: Array.from(index.documents.entries()).map(([id, doc]) => ({
      id,
      tokens: doc.tokens,
      tokenFreq: Array.from(doc.tokenFreq.entries()),
      length: doc.length,
    })),
    idf: Array.from(index.idf.entries()),
  };

  writeFileSync(filePath, JSON.stringify(serialized), "utf-8");
}

export function loadBM25Index(filePath: string): BM25Index | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));

    const documents = new Map<string, BM25Document>();
    for (const doc of data.documents) {
      documents.set(doc.id, {
        id: doc.id,
        tokens: doc.tokens,
        tokenFreq: new Map(doc.tokenFreq),
        length: doc.length,
      });
    }

    return {
      documents,
      docCount: data.docCount,
      avgDocLength: data.avgDocLength,
      idf: new Map(data.idf),
    };
  } catch {
    return null;
  }
}

// In-memory cache for BM25 index
let cachedIndex: BM25Index | null = null;

export function getCachedBM25Index(): BM25Index | null {
  return cachedIndex;
}

export function setCachedBM25Index(index: BM25Index | null): void {
  cachedIndex = index;
}

export function getBM25IndexPath(): string {
  const settings = getSettings();
  return join(settings.indexDir, "bm25_index.json");
}
