import { nodeKeyFor, namespaceFromApiName } from "./keys";
import { EDGE_KINDS, edgeTypeKey, nodeTypeKey, type EdgeKind, type NodeKind } from "./nodeTypes";
import type { Confidence, EdgeDraft, NodeDraft } from "./types";

// Draft constructors shared by every scanner, so node identity (kind, namespace, fqn) is computed in
// exactly one place and a scanner can never disagree with another about a node's key.

export type NodeSpec = {
  fqn: string;
  label: string;
  // Defaults to the namespace embedded in the last dotted segment of the fqn (Object.ns__Field__c).
  namespace?: string | null;
  parentKey?: string | null;
  attributes?: Record<string, unknown>;
};

export function lastSegment(fqn: string): string {
  const dot = fqn.lastIndexOf(".");
  return dot < 0 ? fqn : fqn.slice(dot + 1);
}

export function nodeNamespace(fqn: string, explicit?: string | null): string | null {
  return explicit !== undefined ? explicit : namespaceFromApiName(lastSegment(fqn));
}

export function keyOf(kind: NodeKind, fqn: string, explicitNamespace?: string | null): string {
  return nodeKeyFor(kind, nodeNamespace(fqn, explicitNamespace), fqn);
}

export function nodeDraft(kind: NodeKind, spec: NodeSpec): { key: string; draft: NodeDraft } {
  const namespace = nodeNamespace(spec.fqn, spec.namespace);
  return {
    key: nodeKeyFor(kind, namespace, spec.fqn),
    draft: {
      typeKey: nodeTypeKey(kind),
      namespace,
      fqn: spec.fqn,
      label: spec.label,
      parentKey: spec.parentKey ?? null,
      attributes: spec.attributes ?? {},
    },
  };
}

export function edgeDraft(
  kind: EdgeKind,
  sourceNodeKey: string,
  targetNodeKey: string,
  over: { confidence?: Confidence; attributes?: Record<string, unknown> } = {}
): EdgeDraft {
  return {
    typeKey: edgeTypeKey(kind),
    sourceNodeKey,
    targetNodeKey,
    confidence: over.confidence ?? EDGE_KINDS[kind].defaultConfidence,
    attributes: over.attributes ?? {},
  };
}

// An edge's identity is (source, type, target); a scanner that finds the same relationship twice
// keeps one edge. The first occurrence wins so output is deterministic for a given input order.
export function dedupeEdges(edges: EdgeDraft[]): EdgeDraft[] {
  const seen = new Set<string>();
  const out: EdgeDraft[] = [];
  for (const edge of edges) {
    const id = `${edge.sourceNodeKey}\u0000${edge.typeKey}\u0000${edge.targetNodeKey}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(edge);
  }
  return out;
}
