import type { Confidence, EdgeStyle } from "./graphApi";
import type { VisibleGraph, VisibleNode } from "./viewState";

// Hub clustering. A node with hundreds of same-kind neighbours (an object's fields, a hot field's Apex
// callers) would bury the canvas, so more than CLUSTER_THRESHOLD same-type nodes with the same parent at
// the same ring collapse into one synthetic card. Opening the card puts its members back.

export const CLUSTER_THRESHOLD = 8;

export type RenderNode = {
  key: string;
  kind: "node" | "cluster";
  ring: number;
  typeKey: string;
  kindLabel: string;
  label: string;
  parentKey: string | null;
  // Parent's label, when the parent is on screen: lets a cluster say "fields of Invoice__c".
  hint: string | null;
  node?: VisibleNode;
  members?: VisibleNode[];
};

export type RenderEdge = {
  key: string;
  source: string;
  target: string;
  kind: string;
  style: EdgeStyle;
  // The weakest confidence among the edges merged into this one, so doubt is never hidden by clustering.
  confidence: Confidence;
  sourceRole: string;
  targetRole: string;
  viaField: string | null;
  count: number;
};

export type ClusterOptions = {
  threshold?: number;
  // Never clustered: the focus node, the selection and anything the user expanded.
  pinned?: ReadonlySet<string>;
  openClusters?: ReadonlySet<string>;
};

export const clusterId = (ring: number, typeKey: string, parentKey: string | null) => `cluster:${ring}:${typeKey}:${parentKey ?? ""}`;

export function pluralize(label: string): string {
  if (/(s|x|ch|sh)$/i.test(label)) return `${label}es`;
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  return `${label}s`;
}

const WEAKEST: Record<Confidence, number> = { exact: 0, parsed: 1, heuristic: 2 };

export function clusterHubs(graph: VisibleGraph, options: ClusterOptions = {}): { nodes: RenderNode[]; edges: RenderEdge[] } {
  const threshold = options.threshold ?? CLUSTER_THRESHOLD;
  const pinned = options.pinned ?? new Set<string>();
  const open = options.openClusters ?? new Set<string>();
  const byKey = new Map(graph.nodes.map((n) => [n.nodeKey, n]));

  const groups = new Map<string, VisibleNode[]>();
  for (const n of graph.nodes) {
    if (n.ring < 1 || pinned.has(n.nodeKey)) continue;
    const id = clusterId(n.ring, n.typeKey, n.parentKey);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(n);
  }

  const memberOf = new Map<string, string>();
  const clusters: RenderNode[] = [];
  for (const [id, members] of groups) {
    if (members.length <= threshold || open.has(id)) continue;
    members.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    const first = members[0];
    for (const m of members) memberOf.set(m.nodeKey, id);
    clusters.push({
      key: id,
      kind: "cluster",
      ring: first.ring,
      typeKey: first.typeKey,
      kindLabel: first.kindLabel,
      label: `${members.length} ${pluralize(first.kindLabel)}`,
      parentKey: first.parentKey,
      hint: first.parentKey ? (byKey.get(first.parentKey)?.label ?? null) : null,
      members,
    });
  }

  const nodes: RenderNode[] = graph.nodes
    .filter((n) => !memberOf.has(n.nodeKey))
    .map((n) => ({
      key: n.nodeKey,
      kind: "node" as const,
      ring: n.ring,
      typeKey: n.typeKey,
      kindLabel: n.kindLabel,
      label: n.label,
      parentKey: n.parentKey,
      hint: null,
      node: n,
    }));
  nodes.push(...clusters);

  // Re-point edges at clusters, merge duplicates, and drop any that ended up inside one cluster.
  const merged = new Map<string, RenderEdge>();
  for (const e of graph.edges) {
    const source = memberOf.get(e.source) ?? e.source;
    const target = memberOf.get(e.target) ?? e.target;
    if (source === target && (source !== e.source || target !== e.target)) continue;
    const rewired = source !== e.source || target !== e.target;
    const key = rewired ? `${source}|${target}|${e.kind}` : e.edgeKey;
    const existing = merged.get(key);
    if (existing) {
      existing.count += 1;
      if (WEAKEST[e.confidence] > WEAKEST[existing.confidence]) existing.confidence = e.confidence;
      if (existing.viaField !== e.viaField) existing.viaField = null;
    } else {
      merged.set(key, {
        key,
        source,
        target,
        kind: e.kind,
        style: e.style,
        confidence: e.confidence,
        sourceRole: e.sourceRole,
        targetRole: e.targetRole,
        viaField: e.viaField,
        count: 1,
      });
    }
  }
  return { nodes, edges: [...merged.values()] };
}
