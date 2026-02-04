import { getSettings } from "../core/config";
import type { Entity, ExtractionResult } from "../core/models";

let nerPipeline: unknown | null = null;

interface NERResult {
  word: string;
  entity_group: string;
  score: number;
  start: number;
  end: number;
}

const LABEL_MAPPING: Record<string, string> = {
  PER: "person",
  PERSON: "person",
  ORG: "organization",
  ORGANIZATION: "organization",
  LOC: "location",
  LOCATION: "location",
  MISC: "concept",
};

export async function getNERPipeline(): Promise<unknown | null> {
  if (nerPipeline) return nerPipeline;
  try {
    const { pipeline } = await import("@xenova/transformers");
    nerPipeline = await pipeline("token-classification", "Xenova/bert-base-NER");
    return nerPipeline;
  } catch {
    return null;
  }
}

export function resetNERPipeline(): void {
  nerPipeline = null;
}

export async function extractNamedEntities(
  text: string,
  chunkId: string,
  entityTypes?: string[]
): Promise<ExtractionResult> {
  const settings = getSettings();
  const entities: Entity[] = [];
  const pipeline = await getNERPipeline();
  if (!pipeline) {
    return { entities: [], relations: [] };
  }
  const allowedTypes = entityTypes ?? settings.nerEntityTypes;
  try {
    const results = (await (pipeline as CallableFunction)(text, {
      aggregation_strategy: "simple",
    })) as NERResult[];
    const entityGroups: Map<string, { type: string; mentions: string[] }> = new Map();
    for (const result of results) {
      const entityType = LABEL_MAPPING[result.entity_group] || "concept";
      if (!allowedTypes.includes(entityType)) {
        continue;
      }
      const entityName = result.word.trim();
      if (!entityName) continue;
      const key = `${entityType}:${entityName}`;
      const existing = entityGroups.get(key);
      if (existing) {
        existing.mentions.push(entityName);
      } else {
        entityGroups.set(key, {
          type: entityType,
          mentions: [entityName],
        });
      }
    }
    for (const [key, data] of entityGroups) {
      const name = key.slice(`${data.type}:`.length);
      entities.push({
        name,
        type: data.type,
        source: "ner",
        chunkIds: [chunkId],
      });
    }
  } catch {
    // NER failed, return empty result
  }
  return { entities, relations: [] };
}

export async function batchExtractNamedEntities(
  texts: string[],
  chunkIds: string[],
  entityTypes?: string[]
): Promise<ExtractionResult[]> {
  const results: ExtractionResult[] = [];
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const chunkId = chunkIds[i];
    // Always push a result to maintain 1:1 alignment with input arrays
    if (!text || !chunkId) {
      results.push({ entities: [], relations: [] });
      continue;
    }
    const result = await extractNamedEntities(text, chunkId, entityTypes);
    results.push(result);
  }
  return results;
}
