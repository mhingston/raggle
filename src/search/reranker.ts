import { getSettings } from "../core/config";
import type { Chunk, SearchResult } from "../core/models";
import { getMetadataStore } from "../storage";
import { estimateTokens } from "../utils/text";

let rerankerPipeline: unknown | null = null;

export async function getRerankerPipeline(): Promise<unknown | null> {
  if (rerankerPipeline) return rerankerPipeline;
  try {
    const { pipeline } = await import("@xenova/transformers");
    const settings = getSettings();
    rerankerPipeline = await pipeline("text-classification", settings.rerankerModel);
    return rerankerPipeline;
  } catch {
    return null;
  }
}

export function resetRerankerPipeline(): void {
  rerankerPipeline = null;
}

export function calculateLengthPenalty(text: string): number {
  const settings = getSettings();
  const estimatedTokens = estimateTokens(text);
  if (estimatedTokens < settings.rerankerMinLength) {
    return 0.8;
  }
  return 1.0;
}

export async function rerankResults(
  query: string,
  chunkIds: string[],
  topK: number
): Promise<Array<[string, number]>> {
  const settings = getSettings();
  const metadataStore = getMetadataStore();
  const pipeline = await getRerankerPipeline();

  if (!pipeline) {
    return chunkIds.map((id, idx) => [id, 1.0 - idx * 0.01]);
  }

  const chunks = metadataStore.getChunks(chunkIds);
  const chunkMap = new Map<string, Chunk>();
  for (const chunk of chunks) {
    chunkMap.set(chunk.chunkId, chunk);
  }

  const pairs: Array<{ chunkId: string; text: string }> = [];
  for (const chunkId of chunkIds) {
    const chunk = chunkMap.get(chunkId);
    if (chunk) {
      pairs.push({ chunkId, text: chunk.text });
    }
  }

  const scores: Array<{ chunkId: string; score: number }> = [];
  for (const pair of pairs) {
    try {
      const result = (await (pipeline as CallableFunction)(
        `${query} [SEP] ${pair.text.slice(0, 512)}`,
        { truncation: true }
      )) as { label: string; score: number }[];
      let score = 0;
      if (Array.isArray(result) && result.length > 0) {
        const positiveResult = result.find((r) => r.label === "LABEL_1" || r.label === "positive");
        score = positiveResult?.score ?? result[0]?.score ?? 0;
      }
      const penalty = calculateLengthPenalty(pair.text);
      score *= penalty;
      if (score > settings.rerankerScoreThreshold) {
        scores.push({ chunkId: pair.chunkId, score });
      }
    } catch {
      // Skip failed reranks
    }
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK).map(({ chunkId, score }) => [chunkId, score]);
}

export function blendScores(
  fusedScores: Map<string, number>,
  rerankScores: Map<string, number>,
  fusedWeight: number = 0.4,
  rerankWeight: number = 0.6
): Map<string, number> {
  const blended = new Map<string, number>();
  const fusedMax = Math.max(...fusedScores.values(), 1);
  const rerankMax = Math.max(...rerankScores.values(), 1);
  const allIds = new Set([...fusedScores.keys(), ...rerankScores.keys()]);

  for (const id of allIds) {
    const fusedScore = (fusedScores.get(id) ?? 0) / fusedMax;
    const rerankScore = (rerankScores.get(id) ?? 0) / rerankMax;
    const blendedScore = fusedWeight * fusedScore + rerankWeight * rerankScore;
    blended.set(id, blendedScore);
  }

  return blended;
}

export async function rerankAndBlend(
  query: string,
  fusedResults: Array<[string, { score: number; engines: string[] }]>,
  topK: number,
  engineScores: {
    semanticScores: Map<string, number>;
    bm25Scores: Map<string, number>;
    graphScores: Map<string, number>;
  },
  queryTokens: string[]
): Promise<SearchResult[]> {
  const settings = getSettings();
  const metadataStore = getMetadataStore();
  const poolSize = Math.min(settings.rerankPoolSize, fusedResults.length);
  const pool = fusedResults.slice(0, poolSize);
  const chunkIds = pool.map(([chunkId]) => chunkId);
  const reranked = await rerankResults(query, chunkIds, poolSize);
  const rerankMap = new Map(reranked);
  const fusedMap = new Map(fusedResults.map(([id, data]) => [id, data.score]));
  const blended = blendScores(fusedMap, rerankMap);
  const results: SearchResult[] = [];

  for (const [chunkId, score] of blended) {
    const chunk = metadataStore.getChunk(chunkId);
    if (!chunk) continue;
    const originalData = fusedResults.find(([id]) => id === chunkId)?.[1];

    const snippet = buildSnippet(chunk.text, queryTokens, settings.snippetLength);
    results.push({
      chunkId,
      filePath: chunk.filePath,
      headingPath: chunk.headingHierarchy.join(" > "),
      snippet,
      fusedScore: score,
      semanticScore: engineScores.semanticScores.get(chunkId),
      bm25Score: engineScores.bm25Scores.get(chunkId),
      graphScore: engineScores.graphScores.get(chunkId),
      matchedEngines: originalData?.engines ?? [],
    });
  }

  results.sort((a, b) => b.fusedScore - a.fusedScore);
  return results.slice(0, topK);
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
