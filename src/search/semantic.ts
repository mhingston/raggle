import { getSettings } from "../core/config";
import { getVectorStore } from "../storage";

let embeddingPipeline: unknown | null = null;

export async function getEmbeddingPipeline(): Promise<unknown> {
  if (embeddingPipeline) return embeddingPipeline;

  const { pipeline } = await import("@xenova/transformers");
  const settings = getSettings();
  embeddingPipeline = await pipeline("feature-extraction", settings.embeddingModel);
  return embeddingPipeline;
}

export async function encodeQuery(query: string): Promise<number[]> {
  const embedder = await getEmbeddingPipeline();
  const output = await (embedder as CallableFunction)(query, {
    pooling: "mean",
    normalize: true,
  });
  return Array.from(output.data as Float32Array);
}

export async function semanticSearch(
  query: string,
  topK: number
): Promise<Array<[string, number]>> {
  const queryEmbedding = await encodeQuery(query);
  const vectorStore = getVectorStore(queryEmbedding.length);
  return vectorStore.search(queryEmbedding, topK);
}

export function resetSemanticSearch(): void {
  embeddingPipeline = null;
}
