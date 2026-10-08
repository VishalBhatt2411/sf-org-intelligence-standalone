import { nodeChecksum } from "../graph/checksum";
import { InMemoryGraphRepository } from "../graph/inMemoryGraphRepository";
import { edgeRow, keyOfRef, type EdgeSpec, type Ref } from "../graph/graphTestKit";
import { nodeKeyFor, typeKeyOf } from "../graph/keys";
import { DEFAULT_HEALTH_CONFIG, type HealthConfig } from "./config";
import { InMemoryHealthGraph } from "./healthGraphRepository";

// Test support for the health sections: a graph described by readable specs, with node attributes
// (the plain graphTestKit leaves them empty). Nothing in production imports this.

export type NodeSpecT = { kind: string; fqn: string; attributes?: Record<string, unknown>; parent?: Ref; namespace?: string | null };
export const CONNECTION = "conn-1";

export async function healthGraph(nodes: NodeSpecT[], edges: EdgeSpec[] = [], connectionId = CONNECTION) {
  const repo = new InMemoryGraphRepository();
  await repo.createNodes(
    connectionId,
    "scan-1",
    nodes.map((n) => {
      const draft = { typeKey: typeKeyOf(n.kind), namespace: n.namespace ?? null, fqn: n.fqn, label: n.fqn.split(".").pop()!, parentKey: n.parent ? keyOfRef(n.parent) : null, attributes: n.attributes ?? {} };
      return { ...draft, nodeKey: nodeKeyFor(n.kind, n.namespace ?? null, n.fqn), checksum: nodeChecksum(draft) };
    }),
  );
  await repo.createEdges(connectionId, "scan-1", edges.map(edgeRow));
  return { repo, graph: new InMemoryHealthGraph(repo) };
}

type Override = { [K in keyof HealthConfig]?: HealthConfig[K] extends object ? Partial<HealthConfig[K]> : HealthConfig[K] };

export const withConfig = (over: Override): HealthConfig => {
  const out = structuredClone(DEFAULT_HEALTH_CONFIG) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) out[k] = v !== null && typeof v === "object" && !Array.isArray(v) ? { ...(out[k] as object), ...v } : v;
  return out as unknown as HealthConfig;
};

export const NOW = new Date("2026-10-08T10:00:00.000Z");
export const keyFor = (kind: string, fqn: string, namespace: string | null = null) => nodeKeyFor(kind, namespace, fqn);
