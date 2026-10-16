import type { EdgeStyle, GraphEdge } from "./graphApi";
import type { VisibleGraph } from "./viewState";

// Relationship legend and filters for the Field canvas (port of native oiFilterPanel and
// graphRelationshipFilter.applyRelationshipFilter). The filter walks out from the centre along the edge types
// still switched on, in the chosen direction, so a hidden type also hides whatever was reachable only through
// it. Pure so it can be tested without a browser.

export type DirectionFilter = { parents: boolean; children: boolean };

export type RelationshipFilter = {
  // Edge type keys switched off in the legend.
  hiddenTypes: ReadonlySet<string>;
  direction: DirectionFilter;
  // "Direct relationships only": one hop from the centre, no grandparents or grandchildren.
  directOnly: boolean;
};

export const DEFAULT_FILTER: RelationshipFilter = { hiddenTypes: new Set(), direction: { parents: true, children: true }, directOnly: false };

export const isFilterActive = (f: RelationshipFilter): boolean => f.hiddenTypes.size > 0 || f.directOnly || !f.direction.parents || !f.direction.children;

// Native refuses to leave both directions off; unticking the last one is ignored.
export function toggleDirection(direction: DirectionFilter, which: keyof DirectionFilter): DirectionFilter {
  const next = { ...direction, [which]: !direction[which] };
  return next.parents || next.children ? next : direction;
}

export function toggleType(hidden: ReadonlySet<string>, typeKey: string): ReadonlySet<string> {
  const next = new Set(hidden);
  if (next.has(typeKey)) next.delete(typeKey);
  else next.add(typeKey);
  return next;
}

export function applyRelationshipFilter(graph: VisibleGraph, rootKey: string, filter: RelationshipFilter): VisibleGraph {
  if (!isFilterActive(filter)) return graph;
  const known = new Set(graph.nodes.map((n) => n.nodeKey));
  if (!known.has(rootKey)) return graph;
  const outgoing = filter.direction.parents;
  const incoming = filter.direction.children;
  const maxDepth = filter.directOnly ? 1 : Infinity;

  const allowed = graph.edges.filter((e) => !filter.hiddenTypes.has(e.typeKey) && known.has(e.source) && known.has(e.target));
  const bySource = new Map<string, GraphEdge[]>();
  const byTarget = new Map<string, GraphEdge[]>();
  for (const e of allowed) {
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    bySource.get(e.source)!.push(e);
    if (!byTarget.has(e.target)) byTarget.set(e.target, []);
    byTarget.get(e.target)!.push(e);
  }

  const depth = new Map<string, number>([[rootKey, 0]]);
  const kept = new Set<string>();
  const queue = [rootKey];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    const d = depth.get(current)!;
    if (d >= maxDepth) continue;
    const step = (e: GraphEdge, other: string) => {
      kept.add(e.edgeKey);
      if (depth.has(other)) return;
      depth.set(other, d + 1);
      queue.push(other);
    };
    if (outgoing) for (const e of bySource.get(current) ?? []) step(e, e.target);
    if (incoming) for (const e of byTarget.get(current) ?? []) step(e, e.source);
  }

  return {
    nodes: graph.nodes.filter((n) => depth.has(n.nodeKey)),
    edges: graph.edges.filter((e) => kept.has(e.edgeKey)),
  };
}

// Legend copy per edge kind, worded the way native's filter panel describes each line.
const DESCRIPTIONS: Record<string, { label: string; description: string }> = {
  HAS_FIELD: { label: "Has Field", description: "An object owns this field" },
  LOOKUP_TO: { label: "Lookup", description: "A lookup field points at another object" },
  MASTER_DETAIL_TO: { label: "Master-Detail", description: "A master-detail field ties a child to its parent" },
  EXECUTES_ON: { label: "Executes On", description: "A trigger or flow runs when this object changes" },
  APPLIES_TO: { label: "Applies To", description: "A rule or process is defined on this object" },
  VALIDATES: { label: "Validates", description: "A validation rule checks this field or object" },
  GRANTS_ACCESS_TO: { label: "Grants Access", description: "A permission set or sharing rule opens access" },
  REFERENCES: { label: "References", description: "Code or automation mentions this (inferred from source)" },
  DEPENDS_ON: { label: "Depends On", description: "One component needs the other to work" },
};

export type LegendEntry = { typeKey: string; kind: string; label: string; description: string; style: EdgeStyle; count: number };

// One row per edge type present on the canvas, most used first, so the legend explains only what is drawn.
export function legendEntries(edges: readonly GraphEdge[]): LegendEntry[] {
  const byType = new Map<string, LegendEntry>();
  for (const e of edges) {
    const entry = byType.get(e.typeKey);
    if (entry) {
      entry.count += 1;
      continue;
    }
    const copy = DESCRIPTIONS[e.kind] ?? { label: e.sourceRole || e.kind, description: `${e.sourceRole} / ${e.targetRole}` };
    byType.set(e.typeKey, { typeKey: e.typeKey, kind: e.kind, label: copy.label, description: copy.description, style: e.style, count: 1 });
  }
  return [...byType.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
