import type { GraphEdge, ImpactResponse } from "./graphApi";
import type { VisibleGraph, VisibleNode } from "./viewState";

// Field mode's working-set rules (port of native oiGraphExplorer's handleHighlightImpact and its ceiling).
// "Highlight on Graph" merges the impact subgraph into the canvas, adding the nodes that were not drawn yet,
// then emphasises it; the canvas stops growing once it holds WORKING_SET_CEILING nodes.

export const WORKING_SET_CEILING = 1000;
export const CEILING_MESSAGE = "Your graph has gotten large — collapse a branch you're done exploring to continue.";

export const atCeiling = (workingSetSize: number, ceiling = WORKING_SET_CEILING): boolean => workingSetSize >= ceiling;

// Highlight hands over node keys only; the matching impact answer is already cached by the panel. Pick the
// cached response rooted at the first key whose nodes are exactly the rest.
export function findImpactResponse(candidates: ReadonlyArray<readonly [unknown, ImpactResponse | undefined]>, keys: readonly string[]): ImpactResponse | null {
  if (keys.length === 0) return null;
  const want = new Set(keys.slice(1));
  let fallback: ImpactResponse | null = null;
  for (const [, res] of candidates) {
    if (!res || res.root.nodeKey !== keys[0]) continue;
    fallback ??= res;
    if (res.nodes.length === want.size && res.nodes.every((n) => want.has(n.nodeKey))) return res;
  }
  return fallback;
}

// Adds the impact nodes and edges missing from the canvas. A new node sits one ring per hop beyond the
// impact root. Dropped entirely when the root itself is no longer drawn (its branch was collapsed).
export function mergeImpactOverlay(graph: VisibleGraph, overlay: ImpactResponse | null): VisibleGraph {
  if (!overlay) return graph;
  const root = graph.nodes.find((n) => n.nodeKey === overlay.root.nodeKey);
  if (!root) return graph;
  const have = new Set(graph.nodes.map((n) => n.nodeKey));
  const added: VisibleNode[] = [];
  for (const n of overlay.nodes) {
    if (have.has(n.nodeKey)) continue;
    have.add(n.nodeKey);
    const { distance, ...node } = n;
    added.push({ ...node, ring: root.ring + Math.max(1, distance) });
  }
  const edgeKeys = new Set(graph.edges.map((e) => e.edgeKey));
  const addedEdges: GraphEdge[] = overlay.edges.filter((e) => !edgeKeys.has(e.edgeKey) && have.has(e.source) && have.has(e.target));
  if (added.length === 0 && addedEdges.length === 0) return graph;
  return { nodes: [...graph.nodes, ...added], edges: [...graph.edges, ...addedEdges] };
}

// The keys to emphasise: the impact root and everything it reaches.
export const impactKeys = (res: ImpactResponse): string[] => [res.root.nodeKey, ...res.nodes.map((n) => n.nodeKey)];
