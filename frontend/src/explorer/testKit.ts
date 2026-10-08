import type { GraphEdge, GraphNode, RingNode } from "./graphApi";

// Builders for the Explorer's pure-function tests.

export function node(key: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    nodeKey: key,
    typeKey: "SalesforceMetadata.ApexClass",
    kind: "ApexClass",
    kindLabel: "Apex Class",
    categories: ["code"],
    label: key,
    fqn: key,
    namespace: null,
    parentKey: null,
    checksum: `sum-${key}`,
    attributes: {},
    ...over,
  };
}

export function ringNode(key: string, ring: number, over: Partial<GraphNode> = {}): RingNode {
  return { ...node(key, over), ring };
}

export function edge(source: string, target: string, over: Partial<GraphEdge> = {}): GraphEdge {
  return {
    edgeKey: `${source}>${target}`,
    typeKey: "SalesforceMetadata.REFERENCES",
    kind: "REFERENCES",
    style: "dotted",
    sourceRole: "References",
    targetRole: "Referenced By",
    source,
    target,
    confidence: "exact",
    viaField: null,
    attributes: {},
    ...over,
  };
}
