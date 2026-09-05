import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { assertNotReadOnly, getSettings } from "../core/config";
import type { Chunk, FileInfo, IndexStats } from "../core/models";
import { extractAllAcronyms, saveAcronymDictionary } from "../extraction/acronyms";
import { extractKeyTermsWithStats, precomputeCorpusStats } from "../extraction/keyterms";
import { batchExtractNamedEntities } from "../extraction/ner";
import { extractStructural } from "../extraction/structural";
import {
  buildBM25Index,
  getBM25IndexPath,
  saveBM25Index,
  setCachedBM25Index,
} from "../search/bm25";
import { getGraphStore, getMetadataStore, getVectorStore } from "../storage";
import { chunkMarkdown } from "./chunker";
import { discoverMarkdownFiles, readFileContent } from "./reader";

export type IndexingProgress = {
  phase: "discovering" | "chunking" | "embedding" | "extracting" | "storing";
  current: number;
  total: number;
  message: string;
};

export type IndexingOptions = {
  onProgress?: (progress: IndexingProgress) => void;
  extractDepth?: "structural" | "ner";
  entityTypes?: string[];
  exclude?: string[];
  rebuild?: boolean;
};

export type IndexingResult = {
  filesProcessed: number;
  chunksCreated: number;
  entitiesExtracted: number;
  edgesCreated: number;
  durationMs: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embeddingPipeline: any | null = null;

async function getEmbeddingPipeline(): Promise<any> {
  if (embeddingPipeline) {
    return embeddingPipeline;
  }

  const settings = getSettings();
  const { pipeline } = await import("@xenova/transformers");
  embeddingPipeline = await pipeline("feature-extraction", settings.embeddingModel);
  return embeddingPipeline;
}

export async function indexDirectory(
  directory: string,
  options: IndexingOptions = {}
): Promise<IndexingResult> {
  assertNotReadOnly("indexDirectory");
  const startTime = Date.now();
  const settings = getSettings();
  const metadataStore = getMetadataStore();
  const graphStore = getGraphStore();
  const rebuild = options.rebuild ?? false;

  const effectiveExtractDepth = options.extractDepth ?? settings.extractDepth;
  const effectiveEntityTypes = options.entityTypes ?? settings.nerEntityTypes;

  if (rebuild) {
    // Clear existing data
    metadataStore.deleteAll();
    graphStore.deleteAll();
    const bm25Path = getBM25IndexPath();
    if (existsSync(bm25Path)) {
      unlinkSync(bm25Path);
    }
    const acronymPath = join(settings.indexDir, "acronyms.json");
    if (existsSync(acronymPath)) {
      unlinkSync(acronymPath);
    }
  }

  // Phase 1: Discover files
  options.onProgress?.({
    phase: "discovering",
    current: 0,
    total: 0,
    message: "Discovering Markdown files...",
  });

  const files = await discoverMarkdownFiles(directory, { exclude: options.exclude });

  options.onProgress?.({
    phase: "discovering",
    current: files.length,
    total: files.length,
    message: `Found ${files.length} Markdown files`,
  });

  // Load existing file metadata for incremental indexing
  const existingFiles = rebuild ? [] : metadataStore.getFiles();
  const existingByPath = new Map(existingFiles.map((f) => [f.path, f]));
  const existingByChecksum = new Map<string, FileInfo[]>();
  for (const file of existingFiles) {
    const list = existingByChecksum.get(file.checksum) ?? [];
    list.push(file);
    existingByChecksum.set(file.checksum, list);
  }

  const currentPaths = new Set(files.map((f) => f.path));
  const movedFromPaths = new Set<string>();
  const changedPaths = new Set<string>();
  const filesToIndex: FileInfo[] = [];

  for (const file of files) {
    const existing = existingByPath.get(file.path);
    if (existing && existing.checksum === file.checksum) {
      continue;
    }
    if (existing && existing.checksum !== file.checksum) {
      changedPaths.add(existing.path);
    }
    if (!existing) {
      const candidates = existingByChecksum.get(file.checksum) ?? [];
      for (const moved of candidates) {
        if (moved.path !== file.path && !currentPaths.has(moved.path)) {
          movedFromPaths.add(moved.path);
        }
      }
    }
    filesToIndex.push(file);
  }

  const deletedPaths = existingFiles
    .map((f) => f.path)
    .filter((path) => !currentPaths.has(path) && !movedFromPaths.has(path));

  const pathsToRemove = new Set<string>([...deletedPaths, ...movedFromPaths, ...changedPaths]);

  const chunkIdsToRemove: string[] = [];

  const removeFileData = (filePath: string): void => {
    const chunkIds = metadataStore.getChunkIdsByFile(filePath);
    if (chunkIds.length > 0) {
      chunkIdsToRemove.push(...chunkIds);
      const nodeIds = [`file:${filePath}`, ...chunkIds.map((id) => `section:${id}`)];
      graphStore.deleteNodes(nodeIds);
      graphStore.deleteEdgesByChunkIds(chunkIds);
      metadataStore.deleteChunksByFile(filePath);
    }
    metadataStore.deleteFiles([filePath]);
  };

  for (const path of pathsToRemove) {
    removeFileData(path);
  }

  if (filesToIndex.length === 0 && pathsToRemove.size === 0) {
    if (rebuild) {
      const vectorStore = getVectorStore(settings.embeddingDim);
      vectorStore.deleteAll();
    }
    return {
      filesProcessed: 0,
      chunksCreated: 0,
      entitiesExtracted: 0,
      edgesCreated: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // Phase 2: Chunk files
  options.onProgress?.({
    phase: "chunking",
    current: 0,
    total: filesToIndex.length,
    message: "Chunking documents...",
  });

  const allChunks: Chunk[] = [];
  const fileStructuralByPath = new Map<string, ReturnType<typeof extractStructural>>();

  const successfullyReadFiles: FileInfo[] = [];
  for (let i = 0; i < filesToIndex.length; i++) {
    const file = filesToIndex[i];
    if (!file) continue;

    let content = "";
    try {
      content = await readFileContent(file.path);
    } catch (error) {
      console.warn(`Warning: failed to read ${file.path}:`, error);
      continue;
    }
    const chunks = chunkMarkdown(content, file.path, 0);

    allChunks.push(...chunks);
    const fileStructural = extractStructural(content, file.path, chunks[0]?.chunkId ?? "");
    fileStructuralByPath.set(file.path, fileStructural);
    successfullyReadFiles.push(file);

    // Add file node to graph
    graphStore.addFileNode(file.path, file.title, file.checksum);

    options.onProgress?.({
      phase: "chunking",
      current: i + 1,
      total: filesToIndex.length,
      message: `Chunked ${file.path} (${chunks.length} chunks)`,
    });
  }

  // Phase 3: Generate embeddings
  options.onProgress?.({
    phase: "embedding",
    current: 0,
    total: allChunks.length,
    message: "Generating embeddings...",
  });

  const embedder = await getEmbeddingPipeline();
  const embeddings: (number[] | null)[] = [];

  // Process in batches to avoid memory issues
  const batchSize = 32;
  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    const texts = batch.map((c) => c.text);

    const outputs = await embedder(texts, {
      pooling: "mean",
      normalize: true,
    });

    for (let j = 0; j < batch.length; j++) {
      const output = outputs[j];
      // Push embedding or null to maintain 1:1 alignment with allChunks
      if (output?.data) {
        const embedding = Array.from(output.data as Float32Array);
        embeddings.push(embedding);
      } else {
        embeddings.push(null);
      }
    }

    options.onProgress?.({
      phase: "embedding",
      current: Math.min(i + batchSize, allChunks.length),
      total: allChunks.length,
      message: `Embedded ${Math.min(i + batchSize, allChunks.length)}/${allChunks.length} chunks`,
    });
  }

  // Filter out chunks with missing embeddings before vector storage
  const validChunks: Chunk[] = [];
  const validEmbeddings: number[][] = [];
  let missingEmbeddingCount = 0;
  for (let i = 0; i < allChunks.length; i++) {
    const embedding = embeddings[i];
    if (embedding) {
      validChunks.push(allChunks[i]);
      validEmbeddings.push(embedding);
    } else {
      missingEmbeddingCount++;
    }
  }

  if (missingEmbeddingCount > 0) {
    console.warn(
      `Warning: ${missingEmbeddingCount} chunk(s) had missing embeddings and will be excluded from vector search. ` +
        `These chunks will still be searchable via BM25 and graph search.`
    );
  }

  // Phase 4: Store data
  options.onProgress?.({
    phase: "storing",
    current: 0,
    total: 3,
    message: "Storing chunks and embeddings...",
  });

  const detectedDim = validEmbeddings[0]?.length ?? settings.embeddingDim;
  const vectorStore = getVectorStore(detectedDim);

  if (rebuild) {
    vectorStore.deleteAll();
  }

  if (chunkIdsToRemove.length > 0) {
    vectorStore.deleteChunks(chunkIdsToRemove);
  }

  const existingDocs = metadataStore.getAllChunks().map((c) => c.text);

  metadataStore.saveChunks(allChunks);
  metadataStore.saveFiles(successfullyReadFiles);
  options.onProgress?.({
    phase: "storing",
    current: 1,
    total: 3,
    message: "Storing vectors...",
  });

  // Only store chunks with valid embeddings
  if (validChunks.length > 0) {
    vectorStore.addChunks(validChunks, validEmbeddings);
  }
  options.onProgress?.({
    phase: "storing",
    current: 2,
    total: 3,
    message: "Storing graph nodes...",
  });

  // Add section nodes to graph
  for (const chunk of allChunks) {
    const heading = chunk.headingHierarchy[chunk.headingHierarchy.length - 1] ?? "";
    graphStore.addSectionNode(
      chunk.chunkId,
      heading,
      chunk.level,
      chunk.filePath,
      chunk.text.slice(0, 200)
    );
  }

  // Phase 5: Extraction (structural + keyterms + NER)
  let entitiesExtracted = 0;
  let edgesCreated = 0;
  const entitiesByChunk = new Map<string, Set<string>>();

  const addEntityToChunk = (chunkId: string, entityId: string): void => {
    const set = entitiesByChunk.get(chunkId) ?? new Set<string>();
    set.add(entityId);
    entitiesByChunk.set(chunkId, set);
  };

  const chunkMapByFile = new Map<string, Chunk[]>();
  for (const chunk of allChunks) {
    const list = chunkMapByFile.get(chunk.filePath) ?? [];
    list.push(chunk);
    chunkMapByFile.set(chunk.filePath, list);
  }

  const headingToChunk = new Map<string, string>();
  for (const [filePath, chunks] of chunkMapByFile.entries()) {
    for (const chunk of chunks) {
      const headingPath = chunk.headingHierarchy.join(" > ");
      if (!headingToChunk.has(`${filePath}:${headingPath}`)) {
        headingToChunk.set(`${filePath}:${headingPath}`, chunk.chunkId);
      }
    }
  }

  const structuralResults = new Map<string, ReturnType<typeof extractStructural>>();
  for (const chunk of allChunks) {
    const structural = extractStructural(chunk.text, chunk.filePath, chunk.chunkId);
    structuralResults.set(chunk.chunkId, structural);
    for (const entity of structural.entities) {
      entitiesExtracted++;
      if (entity.type === "tag") {
        graphStore.addTagNode(entity.name);
        graphStore.addEdge(`section:${chunk.chunkId}`, `tag:${entity.name}`, "HAS_TAG", 1.0);
        edgesCreated++;
      } else {
        graphStore.addEntityNode(entity.name, entity.type, entity.source);
        addEntityToChunk(chunk.chunkId, `entity:${entity.type}:${entity.name}`);
        graphStore.addEdge(
          `section:${chunk.chunkId}`,
          `entity:${entity.type}:${entity.name}`,
          entity.type === "concept" ? "LINKS_TO" : "MENTIONS",
          1.0
        );
        edgesCreated++;
      }
    }
  }

  for (const [filePath, structural] of fileStructuralByPath.entries()) {
    for (const relation of structural.relations) {
      if (relation.relationType === "HAS_TAG") {
        graphStore.addTagNode(relation.targetId);
        graphStore.addEdge(
          `file:${filePath}`,
          `tag:${relation.targetId}`,
          "HAS_TAG",
          relation.weight
        );
        edgesCreated++;
      } else if (relation.relationType === "LINKS_TO") {
        graphStore.addEntityNode(relation.targetId, "concept", "structural");
        graphStore.addEdge(
          `file:${filePath}`,
          `entity:concept:${relation.targetId}`,
          "LINKS_TO",
          relation.weight
        );
        edgesCreated++;
      } else if (relation.relationType === "HAS_FRONTMATTER") {
        graphStore.addEntityNode(relation.targetId, "metadata", "structural");
        graphStore.addEdge(
          `file:${filePath}`,
          `entity:metadata:${relation.targetId}`,
          "HAS_FRONTMATTER",
          relation.weight
        );
        edgesCreated++;
      }
    }
  }

  if (effectiveExtractDepth === "ner") {
    const nerResults = await batchExtractNamedEntities(
      allChunks.map((c) => c.text),
      allChunks.map((c) => c.chunkId),
      effectiveEntityTypes
    );

    for (let i = 0; i < nerResults.length; i++) {
      const result = nerResults[i];
      const chunk = allChunks[i];
      if (!result || !chunk) continue;
      for (const entity of result.entities) {
        entitiesExtracted++;
        graphStore.addEntityNode(entity.name, entity.type, entity.source);
        addEntityToChunk(chunk.chunkId, `entity:${entity.type}:${entity.name}`);
        graphStore.addEdge(
          `section:${chunk.chunkId}`,
          `entity:${entity.type}:${entity.name}`,
          "MENTIONS",
          1.0
        );
        edgesCreated++;
      }
    }
  }

  if (effectiveExtractDepth === "ner") {
    // Precompute corpus statistics once for O(N) keyterm extraction
    // instead of O(N^2) when calling extractKeyTerms for each chunk.
    // Include allChunks in the corpus stats to match original behavior where
    // current chunk is part of the document set for TF-IDF calculation.
    const allDocuments = [...existingDocs, ...allChunks.map((c) => c.text)];
    const corpusStats = precomputeCorpusStats(allDocuments);
    const totalDocs = allDocuments.length;

    for (const chunk of allChunks) {
      const keyterms = extractKeyTermsWithStats(chunk.text, chunk.chunkId, corpusStats, totalDocs);
      for (const entity of keyterms.entities) {
        entitiesExtracted++;
        graphStore.addEntityNode(entity.name, entity.type, entity.source);
        addEntityToChunk(chunk.chunkId, `entity:${entity.type}:${entity.name}`);
        graphStore.addEdge(
          `section:${chunk.chunkId}`,
          `entity:${entity.type}:${entity.name}`,
          "MENTIONS",
          0.8
        );
        edgesCreated++;
      }
    }
  }

  // Parent-child section relations (per file)
  for (const [filePath, chunks] of chunkMapByFile.entries()) {
    const seenHeadings = new Set<string>();
    for (const chunk of chunks) {
      const headingPath = chunk.headingHierarchy.join(" > ");
      if (seenHeadings.has(headingPath)) continue;
      seenHeadings.add(headingPath);
      const parentHeading = chunk.headingHierarchy.slice(0, -1).join(" > ");
      if (parentHeading) {
        const parentId = headingToChunk.get(`${filePath}:${parentHeading}`);
        if (parentId) {
          graphStore.addEdge(`section:${parentId}`, `section:${chunk.chunkId}`, "PARENT_OF", 1.0);
          edgesCreated++;
        }
      }
    }
  }

  // Co-occurrence edges within a chunk (entity pairs)
  for (const [_chunkId, entitiesSet] of entitiesByChunk.entries()) {
    const entities = Array.from(entitiesSet);
    if (entities.length < 2) continue;
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const a = entities[i];
        const b = entities[j];
        if (!a || !b) continue;
        graphStore.addEdge(a, b, "CO_OCCURS", 0.5, _chunkId);
        edgesCreated++;
      }
    }
  }

  // Acronym dictionary
  const acronymDict = extractAllAcronyms(metadataStore.getAllChunks().map((c) => c.text));
  saveAcronymDictionary(acronymDict);

  // Persist BM25 index
  const bm25Index = buildBM25Index(metadataStore.getAllChunks());
  saveBM25Index(bm25Index, getBM25IndexPath());
  setCachedBM25Index(bm25Index);

  options.onProgress?.({
    phase: "storing",
    current: 3,
    total: 3,
    message: "Indexing complete!",
  });

  // Save stats
  const stats: IndexStats = {
    totalFiles: metadataStore.getFiles().length,
    totalChunks: metadataStore.getAllChunks().length,
    totalEntities: graphStore.nodeCountByType("entity"),
    totalEdges: graphStore.edgeCount(),
    lastIndexed: new Date(),
  };

  metadataStore.saveStats(stats);

  const durationMs = Date.now() - startTime;

  return {
    filesProcessed: successfullyReadFiles.length,
    chunksCreated: allChunks.length,
    entitiesExtracted,
    edgesCreated,
    durationMs,
  };
}

export function resetIndexingPipeline(): void {
  embeddingPipeline = null;
}
