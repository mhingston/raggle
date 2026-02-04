import { getGraphStore } from "../storage";

export function graphSearch(seedChunkIds: string[], maxHops: number): Array<[string, number]> {
  const graphStore = getGraphStore();
  const visitedScores = new Map<string, number>();

  for (const seedId of seedChunkIds) {
    const nodeId = `section:${seedId}`;
    const neighbors = graphStore.getNeighbors(nodeId, maxHops);

    for (const [neighborId, relationType, weight] of neighbors) {
      const chunkIdMatch = neighborId.match(/^section:(.+)$/);
      if (chunkIdMatch) {
        const chunkId = chunkIdMatch[1];
        if (chunkId) {
          const currentScore = visitedScores.get(chunkId) ?? 0;
          const relationMultiplier =
            relationType === "LINKS_TO" || relationType === "MENTIONS" ? 1.5 : 1.0;
          visitedScores.set(chunkId, currentScore + weight * relationMultiplier);
        }
      }
    }

    visitedScores.set(seedId, 1.0);
  }

  const results: Array<[string, number]> = Array.from(visitedScores.entries());
  results.sort((a, b) => b[1] - a[1]);

  return results;
}
