import { edgeChecksum, nodeChecksum } from "./checksum";
import type { EdgeRow, NodeRow } from "./graphRepository";
import { InMemoryGraphRepository } from "./inMemoryGraphRepository";
import { edgeKey, nodeKeyFor, typeKeyOf } from "./keys";
import type { Confidence } from "./types";

// Helpers for the read-service tests: seed an in-memory graph with readable specs instead of rows.
// Test support only; nothing in production imports this.

export type Ref = readonly [kind: string, fqn: string];
export type EdgeSpec = { type: string; from: Ref; to: Ref; confidence?: Confidence };

export const keyOfRef = ([kind, fqn]: Ref): string => nodeKeyFor(kind, null, fqn);

export function nodeRow(kind: string, fqn: string, parent?: Ref): NodeRow {
  const draft = { typeKey: typeKeyOf(kind), namespace: null, fqn, label: fqn.split(".").pop()!, parentKey: parent ? keyOfRef(parent) : null, attributes: {} };
  return { ...draft, nodeKey: nodeKeyFor(kind, null, fqn), checksum: nodeChecksum(draft) };
}

export function edgeRow({ type, from, to, confidence }: EdgeSpec): EdgeRow {
  const typeKey = typeKeyOf(type);
  const sourceNodeKey = keyOfRef(from);
  const targetNodeKey = keyOfRef(to);
  const draft = { typeKey, sourceNodeKey, targetNodeKey, confidence: confidence ?? "exact", attributes: {} };
  return { ...draft, edgeKey: edgeKey(sourceNodeKey, typeKey, targetNodeKey), checksum: edgeChecksum(draft) };
}

export async function seed(repo: InMemoryGraphRepository, connectionId: string, nodes: Array<Ref | readonly [string, string, Ref]>, edges: EdgeSpec[]): Promise<void> {
  await repo.createNodes(connectionId, "scan-1", nodes.map((n) => nodeRow(n[0], n[1], n[2] as Ref | undefined)));
  await repo.createEdges(connectionId, "scan-1", edges.map(edgeRow));
}

export const nodeKeys = (nodes: Array<{ nodeKey: string }>): string[] => nodes.map((n) => n.nodeKey);
