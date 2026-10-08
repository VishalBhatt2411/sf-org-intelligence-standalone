import { describe, expect, it } from "vitest";
import type { GraphEdge, RingNode, UnchangedNode } from "./graphApi";
import { edge, node, ringNode } from "./testKit";
import { initialViewState, isExpanded, knownChecksums, viewReducer, visibleGraph, type ViewAction, type ViewState } from "./viewState";

const run = (state: ViewState, ...actions: ViewAction[]) => actions.reduce(viewReducer, state);
const keys = (state: ViewState) => visibleGraph(state).nodes.map((n) => n.nodeKey).sort();
const expand = (owner: string, neighbours: string[], edges: GraphEdge[] = [], extra: Partial<Extract<ViewAction, { type: "expanded" }>> = {}): ViewAction => ({
  type: "expanded",
  owner,
  nodes: [ringNode(owner, 0), ...neighbours.map((k) => ringNode(k, 1))],
  edges,
  nextCursor: null,
  truncated: false,
  ...extra,
});

// A -> B, A -> C, B -> D, C -> D
const diamond = () =>
  run(
    initialViewState,
    { type: "focus", node: node("A") },
    expand("A", ["B", "C"], [edge("A", "B"), edge("A", "C")]),
    expand("B", ["A", "D"], [edge("A", "B"), edge("B", "D")]),
    expand("C", ["A", "D"], [edge("A", "C"), edge("C", "D")]),
  );

describe("viewReducer focus and expand", () => {
  it("starts empty and shows only the root after focus", () => {
    expect(visibleGraph(initialViewState)).toEqual({ nodes: [], edges: [] });
    const state = run(initialViewState, { type: "focus", node: node("A") });
    expect(keys(state)).toEqual(["A"]);
    expect(visibleGraph(state).nodes[0].ring).toBe(0);
    expect(state.selectedKey).toBe("A");
  });

  it("shows an expansion's neighbours at ring 1 and its edges", () => {
    const state = run(initialViewState, { type: "focus", node: node("A") }, expand("A", ["B", "C"], [edge("A", "B"), edge("A", "C")]));
    const graph = visibleGraph(state);
    expect(graph.nodes.map((n) => [n.nodeKey, n.ring]).sort()).toEqual([["A", 0], ["B", 1], ["C", 1]]);
    expect(graph.edges).toHaveLength(2);
    expect(isExpanded(state, "A")).toBe(true);
    expect(isExpanded(state, "B")).toBe(false);
  });

  it("does not list the owner among its own neighbours or double-count it", () => {
    const state = run(initialViewState, { type: "focus", node: node("A") }, expand("A", ["B"]));
    expect(state.expansions.A.nodeKeys).toEqual(["B"]);
  });

  it("assigns the shortest ring when a node is reachable at two depths", () => {
    const state = run(
      initialViewState,
      { type: "focus", node: node("A") },
      expand("A", ["B", "D"]),
      expand("B", ["A", "D"]),
    );
    expect(visibleGraph(state).nodes.find((n) => n.nodeKey === "D")!.ring).toBe(1);
  });

  it("resolves unchanged neighbours from the cache and skips ones it never held", () => {
    const base = run(initialViewState, { type: "focus", node: node("A") }, expand("A", ["B"]), { type: "collapse", owner: "A" });
    const unchanged = (k: string): UnchangedNode => ({ nodeKey: k, checksum: `sum-${k}`, ring: 1, unchanged: true });
    const state = run(base, {
      type: "expanded",
      owner: "A",
      nodes: [unchanged("A"), unchanged("B"), unchanged("ghost")],
      edges: [],
      nextCursor: null,
      truncated: false,
    });
    expect(keys(state)).toEqual(["A", "B"]);
  });

  it("appends a further page to an existing expansion", () => {
    const state = run(
      initialViewState,
      { type: "focus", node: node("A") },
      expand("A", ["B"], [edge("A", "B")], { nextCursor: "1:B" }),
      expand("A", ["C"], [edge("A", "C")], { append: true, nextCursor: null, truncated: true }),
    );
    expect(state.expansions.A.nodeKeys).toEqual(["B", "C"]);
    expect(state.expansions.A.nextCursor).toBeNull();
    expect(state.expansions.A.truncated).toBe(true);
    expect(visibleGraph(state).edges).toHaveLength(2);
  });

  it("replaces the expansion when not appending", () => {
    const state = run(initialViewState, { type: "focus", node: node("A") }, expand("A", ["B"]), expand("A", ["C"]));
    expect(keys(state)).toEqual(["A", "C"]);
  });

  it("hides edges whose endpoint is not visible", () => {
    const state = run(initialViewState, { type: "focus", node: node("A") }, expand("A", ["B"], [edge("A", "B"), edge("B", "Z")]));
    expect(visibleGraph(state).edges.map((e) => e.edgeKey)).toEqual(["A>B"]);
  });

  it("starts over on a new focus", () => {
    const state = run(diamond(), { type: "focus", node: node("X") });
    expect(keys(state)).toEqual(["X"]);
    expect(state.expansions).toEqual({});
  });
});

describe("viewReducer collapse (reference-counted visibility)", () => {
  it("keeps a node that another branch still supports (diamond)", () => {
    const state = run(diamond(), { type: "collapse", owner: "B" });
    expect(keys(state)).toEqual(["A", "B", "C", "D"]);
    expect(visibleGraph(state).edges.map((e) => e.edgeKey).sort()).toEqual(["A>B", "A>C", "C>D"]);
  });

  it("removes the node once its last supporting branch collapses", () => {
    const state = run(diamond(), { type: "collapse", owner: "B" }, { type: "collapse", owner: "C" });
    expect(keys(state)).toEqual(["A", "B", "C"]);
  });

  it("collapsing the root removes the whole tree and drops hidden owners' expansions", () => {
    const state = run(diamond(), { type: "collapse", owner: "A" });
    expect(keys(state)).toEqual(["A"]);
    expect(state.expansions).toEqual({});
  });

  it("is a no-op for a node that was never expanded", () => {
    const state = diamond();
    expect(viewReducer(state, { type: "collapse", owner: "D" })).toBe(state);
  });

  it("does not let two nodes that only support each other outlive their common ancestor", () => {
    const state = run(
      initialViewState,
      { type: "focus", node: node("X") },
      expand("X", ["A", "B"]),
      expand("A", ["B"]),
      expand("B", ["A"]),
      { type: "collapse", owner: "X" },
    );
    expect(keys(state)).toEqual(["X"]);
  });

  it("moves the selection back to the root when the selected node disappears", () => {
    const state = run(diamond(), { type: "select", key: "D" }, { type: "collapse", owner: "B" }, { type: "collapse", owner: "C" });
    expect(state.selectedKey).toBe("A");
    const kept = run(diamond(), { type: "select", key: "B" }, { type: "collapse", owner: "C" });
    expect(kept.selectedKey).toBe("B");
  });

  it("re-expands a collapsed branch cleanly", () => {
    const state = run(diamond(), { type: "collapse", owner: "A" }, expand("A", ["B"]));
    expect(keys(state)).toEqual(["A", "B"]);
  });
});

describe("viewReducer trail and selection", () => {
  it("records focus history without duplicates and truncates when revisiting", () => {
    const state = run(initialViewState, { type: "focus", node: node("A") }, { type: "focus", node: node("B") }, { type: "focus", node: node("C") });
    expect(state.trail).toEqual(["A", "B", "C"]);
    const back = run(state, { type: "focus", node: node("B") });
    expect(back.trail).toEqual(["A", "B"]);
    expect(back.rootKey).toBe("B");
  });

  it("returns to an earlier breadcrumb, ignoring an out-of-range index", () => {
    const state = run(initialViewState, { type: "focus", node: node("A") }, { type: "focus", node: node("B") });
    const back = run(state, { type: "trailTo", index: 0 });
    expect(back.rootKey).toBe("A");
    expect(back.trail).toEqual(["A"]);
    expect(viewReducer(state, { type: "trailTo", index: 9 })).toBe(state);
  });

  it("selects and clears", () => {
    const state = run(diamond(), { type: "select", key: "C" });
    expect(state.selectedKey).toBe("C");
    expect(run(state, { type: "clear" })).toEqual(initialViewState);
  });
});

describe("knownChecksums", () => {
  it("lists only nodes held but not on screen, capped", () => {
    const state = run(diamond(), { type: "collapse", owner: "A" });
    expect(knownChecksums(state).sort()).toEqual(["sum-B", "sum-C", "sum-D"]);
    expect(knownChecksums(state, 2)).toHaveLength(2);
    expect(knownChecksums(diamond())).toEqual([]);
  });
});

// Keep the imported helper types referenced so a signature change here fails the build.
const _shape: RingNode = ringNode("x", 1);
void _shape;
