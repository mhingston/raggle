import { describe, expect, test } from "bun:test";
import { graphSearch } from "../src/search/graph";
import { getGraphStore } from "../src/storage";
import { createTempIndexDir } from "./helpers";

describe("search/graph", () => {
  test("graphSearch traverses neighbors", () => {
    createTempIndexDir();
    const store = getGraphStore();
    store.addSectionNode("seed", "Seed", 1, "/tmp/a.md", "seed");
    store.addSectionNode("neighbor", "Neighbor", 1, "/tmp/a.md", "neighbor");
    store.addEdge("section:seed", "section:neighbor", "PARENT_OF", 1.0);

    const results = graphSearch(["seed"], 1);
    const ids = results.map(([id]) => id);
    expect(ids).toContain("seed");
    expect(ids).toContain("neighbor");
  });
});
