import { describe, expect, it } from "vitest";
import type { ImpactResponse } from "./graphApi";
import { WORKING_SET_CEILING, atCeiling, findImpactResponse, impactKeys, mergeImpactOverlay } from "./impactOverlay";
import { edge, node, ringNode } from "./testKit";

function impact(rootKey: string, nodes: Array<[string, number]>, edges = nodes.map(([k]) => edge(k, rootKey))): ImpactResponse {
  return {
    root: node(rootKey),
    direction: "downstream",
    depth: 2,
    nodes: nodes.map(([k, distance]) => ({ ...node(k), distance })),
    edges,
    summary: [],
    truncated: false,
    hasCycle: false,
    cycleNodeKeys: [],
    caveats: [],
  } as ImpactResponse;
}

const graph = { nodes: [ringNode("F", 0), ringNode("A", 1)], edges: [edge("A", "F")] };

describe("mergeImpactOverlay", () => {
  it("adds missing nodes one ring per hop beyond the impact root, and their edges", () => {
    const out = mergeImpactOverlay(graph, impact("A", [["X", 1], ["Y", 2]], [edge("X", "A"), edge("Y", "X"), edge("Z", "A")]));
    expect(out.nodes.map((n) => [n.nodeKey, n.ring])).toEqual([["F", 0], ["A", 1], ["X", 2], ["Y", 3]]);
    expect(out.nodes.find((n) => n.nodeKey === "X")).not.toHaveProperty("distance");
    // Z is not part of the answer's nodes, so its edge is left out.
    expect(out.edges.map((e) => e.edgeKey)).toEqual(["A>F", "X>A", "Y>X"]);
  });

  it("does not duplicate nodes or edges already drawn", () => {
    expect(mergeImpactOverlay(graph, impact("F", [["A", 1]]))).toBe(graph);
  });

  it("is dropped when the impact root is no longer on the canvas, or absent", () => {
    expect(mergeImpactOverlay(graph, impact("Gone", [["X", 1]]))).toBe(graph);
    expect(mergeImpactOverlay(graph, null)).toBe(graph);
  });
});

describe("findImpactResponse", () => {
  it("picks the cached answer whose root and nodes match the highlighted keys", () => {
    const down = impact("A", [["X", 1]]);
    const up = impact("A", [["Y", 1], ["Z", 2]]);
    const other = impact("B", [["X", 1]]);
    const cache = [[["k1"], other], [["k2"], down], [["k3"], up], [["k4"], undefined]] as const;
    expect(findImpactResponse(cache, ["A", "Y", "Z"])).toBe(up);
    expect(findImpactResponse(cache, ["A", "X"])).toBe(down);
    expect(impactKeys(up)).toEqual(["A", "Y", "Z"]);
  });

  it("falls back to any answer for the root, or null", () => {
    const only = impact("A", [["X", 1]]);
    expect(findImpactResponse([[[], only]], ["A", "Q"])).toBe(only);
    expect(findImpactResponse([[[], only]], ["B"])).toBeNull();
    expect(findImpactResponse([[[], only]], [])).toBeNull();
  });
});

describe("working-set ceiling", () => {
  it("matches native's 1,000-node ceiling", () => {
    expect(WORKING_SET_CEILING).toBe(1000);
    expect(atCeiling(999)).toBe(false);
    expect(atCeiling(1000)).toBe(true);
  });
});
