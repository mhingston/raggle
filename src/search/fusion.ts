import { getSettings } from "../core/config";

export interface RankedResult {
  chunkId: string;
  score: number;
  engine: string;
}

export function reciprocalRankFusion(
  rankedLists: RankedResult[][],
  k: number = 60
): Map<string, { score: number; engines: string[] }> {
  const fusedScores = new Map<string, { score: number; engines: string[] }>();

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const result = list[rank];
      if (!result) continue;
      const rrfScore = 1 / (k + rank + 1);
      const existing = fusedScores.get(result.chunkId);
      if (existing) {
        existing.score += rrfScore;
        if (!existing.engines.includes(result.engine)) {
          existing.engines.push(result.engine);
        }
      } else {
        fusedScores.set(result.chunkId, {
          score: rrfScore,
          engines: [result.engine],
        });
      }
    }
  }

  return fusedScores;
}

export function weightedRRF(
  rankedLists: Array<{ results: RankedResult[]; weight: number }>,
  k: number = 60
): Map<string, { score: number; engines: string[] }> {
  const settings = getSettings();
  const fusedScores = new Map<string, { score: number; engines: string[] }>();

  for (const { results, weight } of rankedLists) {
    if (!results[0]) continue;
    const isGraph = results[0].engine === "graph";
    const effectiveWeight = isGraph ? settings.graphRrfWeight : weight;

    for (let rank = 0; rank < results.length; rank++) {
      const result = results[rank];
      if (!result) continue;
      const rrfScore = (effectiveWeight * 1) / (k + rank + 1);
      const existing = fusedScores.get(result.chunkId);
      if (existing) {
        existing.score += rrfScore;
        if (!existing.engines.includes(result.engine)) {
          existing.engines.push(result.engine);
        }
      } else {
        fusedScores.set(result.chunkId, {
          score: rrfScore,
          engines: [result.engine],
        });
      }
    }
  }

  return fusedScores;
}

export function normalizeScores(results: Array<[string, number]>): Array<[string, number]> {
  if (results.length === 0) return [];
  const maxScore = Math.max(...results.map(([, score]) => score));
  const minScore = Math.min(...results.map(([, score]) => score));
  const range = maxScore - minScore;
  if (range === 0) {
    return results.map(([id]) => [id, 1.0]);
  }
  return results.map(([id, score]) => [id, (score - minScore) / range]);
}
