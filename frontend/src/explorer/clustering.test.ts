import { describe, expect, it } from "vitest";
import { CLUSTER_THRESHOLD, clusterHubs, clusterId, pluralize } from "./clustering";
import { edge, node } from "./testKit";
import type { VisibleGraph, VisibleNode } from "./viewState";

const FIELD = { typeKey: "SalesforceMetadata.CustomField", kind: "CustomField", kindLabel: "Field" };
const vis = (key: string, ring: number, over: Partial<VisibleNode> = {}): VisibleNode => ({ ...node(key, over), ring });
const fields = (count: number, parentKey = "obj", ring = 1): VisibleNode[] =>
  Array.from({ length: count }, (_, i) => vis(`f${String(i).padStart(2, "0")}`, ring, { ...FIELD, parentKey, label: `F${i}` }));
const graph = (nodes: VisibleNode[], edges = nodes.filter((x) => x.ring > 0).map((x) => edge("obj", x.nodeKey))): VisibleGraph => ({ nodes, edges });
const root = vis("obj", 0, { typeKey: "SalesforceMetadata.CustomObject", kind: "CustomObject", kindLabel: "Object", label: "Invoice__c" });

describe("clusterHubs", () => {
  it("leaves a group at or below the threshold alone", () => {
    const g = graph([root, ...fields(CLUSTER_THRESHOLD)]);
    const out = clusterHubs(g);
    expect(out.nodes.every((x) => x.kind === "node")).toBe(true);
    expect(out.nodes).toHaveLength(CLUSTER_THRESHOLD + 1);
    expect(out.edges).toHaveLength(CLUSTER_THRESHOLD);
  });

  it("collapses more than the threshold of same-type, same-parent nodes into one card", () => {
    const g = graph([root, ...fields(CLUSTER_THRESHOLD + 1)]);
    const out = clusterHubs(g);
    expect(out.nodes).toHaveLength(2);
    const cluster = out.nodes.find((x) => x.kind === "cluster")!;
    expect(cluster.key).toBe(clusterId(1, FIELD.typeKey, "obj"));
    expect(cluster.label).toBe("9 Fields");
    expect(cluster.members).toHaveLength(9);
    expect(cluster.hint).toBe("Invoice__c");
    expect(cluster.ring).toBe(1);
  });

  it("merges the edges to a cluster into one and keeps the weakest confidence", () => {
    const members = fields(10);
    const edges = members.map((m, i) => edge("obj", m.nodeKey, { confidence: i === 3 ? "heuristic" : "exact" }));
    const out = clusterHubs(graph([root, ...members], edges));
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({ source: "obj", count: 10, confidence: "heuristic" });
    expect(out.edges[0].target).toBe(out.nodes.find((x) => x.kind === "cluster")!.key);
  });

  it("drops edges that fall wholly inside one cluster", () => {
    const members = fields(10);
    const out = clusterHubs(graph([root, ...members], [edge("obj", "f00"), edge("f00", "f01")]));
    expect(out.edges).toHaveLength(1);
  });

  it("does not mix different types, parents or rings", () => {
    const mixed = [
      root,
      ...fields(6, "obj"),
      ...fields(6, "other").map((x) => ({ ...x, nodeKey: `o${x.nodeKey}` })),
      ...Array.from({ length: 6 }, (_, i) => vis(`c${i}`, 1)),
      ...fields(6, "obj", 2).map((x) => ({ ...x, nodeKey: `d${x.nodeKey}` })),
    ];
    expect(clusterHubs(graph(mixed, [])).nodes.every((x) => x.kind === "node")).toBe(true);
  });

  it("never clusters the root, even when its ring is 0", () => {
    const out = clusterHubs(graph([...Array.from({ length: 12 }, (_, i) => vis(`r${i}`, 0)), ...fields(0)], []));
    expect(out.nodes.every((x) => x.kind === "node")).toBe(true);
  });

  it("keeps pinned nodes out of a cluster and counts only the rest", () => {
    const pinned = new Set(["f00", "f01", "f02"]);
    const out = clusterHubs(graph([root, ...fields(14)]), { pinned });
    expect(out.nodes.find((x) => x.kind === "cluster")?.members).toHaveLength(11);
    expect(out.nodes.filter((x) => x.kind === "node").map((x) => x.key)).toEqual(expect.arrayContaining(["f00", "f01", "f02"]));
    // With so many pinned that the rest fit under the threshold, there is no cluster at all.
    const none = clusterHubs(graph([root, ...fields(10)]), { pinned });
    expect(none.nodes.some((x) => x.kind === "cluster")).toBe(false);
  });

  it("shows the members of an opened cluster", () => {
    const g = graph([root, ...fields(12)]);
    const id = clusterId(1, FIELD.typeKey, "obj");
    const out = clusterHubs(g, { openClusters: new Set([id]) });
    expect(out.nodes).toHaveLength(13);
    expect(out.edges).toHaveLength(12);
  });

  it("honours a custom threshold and handles an empty graph", () => {
    expect(clusterHubs(graph([root, ...fields(3)]), { threshold: 2 }).nodes.some((x) => x.kind === "cluster")).toBe(true);
    expect(clusterHubs({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] });
  });

  it("clusters a bulk group of 500 quickly and keeps one edge", () => {
    const out = clusterHubs(graph([root, ...fields(500)]));
    expect(out.nodes).toHaveLength(2);
    expect(out.edges[0].count).toBe(500);
  });
});

describe("pluralize", () => {
  it("handles common endings", () => {
    expect(pluralize("Field")).toBe("Fields");
    expect(pluralize("Apex Class")).toBe("Apex Classes");
    expect(pluralize("Approval Process")).toBe("Approval Processes");
    expect(pluralize("Sharing Policy")).toBe("Sharing Policies");
  });
});
