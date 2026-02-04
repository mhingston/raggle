import { describe, test } from "node:test";
import { expect } from "expect";
import { getGraphStore } from "../src/storage";
import { createTempIndexDir } from "./helpers";

describe("storage/graph", () => {
  test("adds nodes and traverses neighbors", () => {
    createTempIndexDir();
    const store = getGraphStore();
    store.addFileNode("/tmp/a.md", "A", "sum");
    store.addSectionNode("c1", "Heading", 1, "/tmp/a.md", "preview");
    store.addEntityNode("Entity", "concept", "structural");
    store.addEdge("section:c1", "entity:concept:Entity", "MENTIONS", 1.0);
    store.addTagNode("tag");
    store.addEdge("section:c1", "tag:tag", "HAS_TAG", 1.0);

    const neighbors = store.getNeighbors("section:c1", 1);
    const ids = neighbors.map(([id]) => id);
    expect(ids).toContain("entity:concept:Entity");
    expect(ids).toContain("tag:tag");
  });

  test("deleteNodes removes nodes and edges", () => {
    createTempIndexDir();
    const store = getGraphStore();
    store.addFileNode("/tmp/a.md", "A", "sum");
    store.addSectionNode("c1", "Heading", 1, "/tmp/a.md", "preview");
    store.deleteNodes(["file:/tmp/a.md", "section:c1"]);
    expect(store.nodeCount()).toBe(0);
  });
});
