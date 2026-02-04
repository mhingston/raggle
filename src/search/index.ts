import { getSettings, isReadOnly } from "../core/config";
import type { SearchMode, SearchResult } from "../core/models";
import { getMetadataStore } from "../storage";
import {
  bm25Search,
  buildBM25Index,
  getBM25IndexPath,
  getCachedBM25Index,
  loadBM25Index,
  saveBM25Index,
  setCachedBM25Index,
} from "./bm25";
import { normalizeScores, type RankedResult, weightedRRF } from "./fusion";
import { graphSearch } from "./graph";
import { analyzeQuery, expandQuery } from "./query";
import { rerankAndBlend } from "./reranker";
import { encodeQuery, semanticSearch } from "./semantic";

export type GraphSeedMode = "bm25" | "semantic" | "hybrid";

export interface SearchOptions {
  mode?: SearchMode;
  topK?: number;
  rerank?: boolean;
  expand?: boolean;
  graphSeed?: GraphSeedMode;
}

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
  const settings = getSettings();
  const metadataStore = getMetadataStore();

  const mode = options.mode ?? "hybrid";
  const topK = options.topK ?? settings.defaultTopK;
  const shouldRerank = options.rerank ?? true;
  const shouldExpand = options.expand ?? true;
  const graphSeed = options.graphSeed ?? "bm25";

  const stats = metadataStore.getStats();
  if (!stats || stats.totalChunks === 0) {
    throw new Error("No index found. Please run 'raggle index <directory>' first.");
  }

  const expandedQuery = shouldExpand ? expandQuery(query) : query;
  const analysis = analyzeQuery(query, expandedQuery);

  let bm25Index = getCachedBM25Index();
  if (!bm25Index) {
    const loaded = loadBM25Index(getBM25IndexPath());
    if (loaded) {
      bm25Index = loaded;
      setCachedBM25Index(bm25Index);
    } else {
      const chunks = metadataStore.getAllChunks();
      bm25Index = buildBM25Index(chunks);
      if (!isReadOnly()) {
        saveBM25Index(bm25Index, getBM25IndexPath());
      }
      setCachedBM25Index(bm25Index);
    }
  }

  const rankedLists: RankedResult[][] = [];
  const semanticScores = new Map<string, number>();
  const bm25Scores = new Map<string, number>();
  const graphScores = new Map<string, number>();

  const runSemantic = mode === "semantic" || mode === "hybrid";
  const runBm25 = mode === "bm25" || mode === "hybrid";

  if (runSemantic) {
    const semanticResults = await semanticSearch(expandedQuery, topK * 2);
    if (semanticResults.length > 0) {
      const normalized = normalizeScores(semanticResults);
      for (const [chunkId, score] of normalized) {
        semanticScores.set(chunkId, score);
      }
      rankedLists.push(
        normalized.map(([chunkId, score]) => ({
          chunkId,
          score,
          engine: "semantic",
        }))
      );
    }
  }

  if (runBm25) {
    const bm25Results = bm25Search(expandedQuery, bm25Index, topK * 2);
    if (bm25Results.length > 0) {
      const normalized = normalizeScores(bm25Results);
      for (const [chunkId, score] of normalized) {
        bm25Scores.set(chunkId, score);
      }
      rankedLists.push(
        normalized.map(([chunkId, score]) => ({
          chunkId,
          score,
          engine: "bm25",
        }))
      );
    }
  }

  if (mode === "graph" || mode === "hybrid") {
    // Deduplicate seed IDs to stabilize graph results
    const seenIds = new Set<string>();
    let seedSource: string[] = [];
    if (rankedLists.length > 0) {
      seedSource = rankedLists.flat().map((r) => r.chunkId);
    } else if (graphSeed === "semantic") {
      seedSource = (await semanticSearch(expandedQuery, topK * 2)).map(([id]) => id);
    } else if (graphSeed === "hybrid") {
      const bm25Seeds = bm25Search(expandedQuery, bm25Index, topK * 2).map(([id]) => id);
      const semanticSeeds = (await semanticSearch(expandedQuery, topK * 2)).map(([id]) => id);
      seedSource = [...bm25Seeds, ...semanticSeeds];
    } else {
      seedSource = bm25Search(expandedQuery, bm25Index, topK * 2).map(([id]) => id);
    }
    const seedIds = seedSource.filter((id) => {
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    }).slice(0, topK);

    if (seedIds.length > 0) {
      const graphResults = graphSearch(seedIds, settings.graphMaxHops);
      if (graphResults.length > 0) {
        const normalized = normalizeScores(graphResults);
        for (const [chunkId, score] of normalized) {
          graphScores.set(chunkId, score);
        }
        rankedLists.push(
          normalized.map(([chunkId, score]) => ({
            chunkId,
            score,
            engine: "graph",
          }))
        );
      }
    }
  }

  if (rankedLists.length === 0) {
    return [];
  }

  const fused = weightedRRF(
    rankedLists.map((results) => ({ results, weight: 1.0 })),
    settings.fusionK
  );

  const fusedResults: Array<[string, { score: number; engines: string[] }]> = Array.from(
    fused.entries()
  );
  fusedResults.sort((a, b) => b[1].score - a[1].score);

  let finalResults: SearchResult[];

  if (shouldRerank) {
    finalResults = await rerankAndBlend(
      query,
      fusedResults,
      topK,
      { semanticScores, bm25Scores, graphScores },
      analysis.tokens
    );
  } else {
    const chunks = metadataStore.getChunks(fusedResults.slice(0, topK).map(([id]) => id));
    const chunkMap = new Map(chunks.map((c) => [c.chunkId, c]));

    finalResults = fusedResults.slice(0, topK).map(([chunkId, data]) => {
      const chunk = chunkMap.get(chunkId);
      const snippet = chunk
        ? buildSnippet(chunk.text, analysis.tokens, settings.snippetLength)
        : "";
      return {
        chunkId,
        filePath: chunk?.filePath ?? "",
        headingPath: chunk?.headingHierarchy.join(" > ") ?? "",
        snippet,
        fusedScore: data.score,
        semanticScore: semanticScores.get(chunkId),
        bm25Score: bm25Scores.get(chunkId),
        graphScore: graphScores.get(chunkId),
        matchedEngines: data.engines,
      };
    });
  }

  return finalResults;
}

function buildSnippet(text: string, tokens: string[], maxLength: number): string {
  if (!text) return "";
  if (tokens.length === 0) return text.slice(0, maxLength);
  const lower = text.toLowerCase();
  let bestIndex = -1;
  for (const token of tokens) {
    if (!token) continue;
    const idx = lower.indexOf(token.toLowerCase());
    if (idx >= 0 && (bestIndex === -1 || idx < bestIndex)) {
      bestIndex = idx;
    }
  }
  if (bestIndex === -1) return text.slice(0, maxLength);
  const half = Math.floor(maxLength / 2);
  const start = Math.max(0, bestIndex - half);
  const end = Math.min(text.length, start + maxLength);
  return text.slice(start, end).trim();
}

export { semanticSearch, bm25Search, graphSearch, weightedRRF, rerankAndBlend };
export { expandQuery, analyzeQuery, encodeQuery };
