import { clamp } from "./errors";
import { indexNodes, toEdgeDto, toNodeDto, type EdgeDto, type NodeDto } from "./graphDto";
import type { GraphCoverage, GraphReadRepository, StoredEdge, StoredNode } from "./graphReadRepository";
import { IMPACT_EDGE_TYPE_KEYS } from "./nodeTypes";

export const DEFAULT_IMPACT_DEPTH = 2;
export const MAX_IMPACT_DEPTH = 3;
export const IMPACT_NODE_CAP = 150;
const RING_EDGE_CAP = 5000;

// downstream: what is affected if this node changes (the things that reference or depend on it).
// upstream:   what this node itself relies on.
// Edges are stored as "source references / depends on / grants access to / executes on target", so
// downstream walks them backwards and upstream walks them forwards.
export type ImpactDirection = "downstream" | "upstream";

export type ImpactNode = NodeDto & { distance: number };
export type Caveat = { code: string; message: string };

export type ImpactResult = {
  root: NodeDto;
  direction: ImpactDirection;
  depth: number;
  nodes: ImpactNode[];
  edges: EdgeDto[];
  summary: Array<{ typeKey: string; kindLabel: string; count: number }>;
  // The node cap (or a hub's edge cap) cut the result short.
  truncated: boolean;
  hasCycle: boolean;
  // Nodes that sit on a dependency cycle inside the discovered subgraph.
  cycleNodeKeys: string[];
  caveats: Caveat[];
};

// Which edge kinds were not followed is worth saying out loud: structural edges (a field belongs to
// its object) are not impact, and a user comparing with Salesforce's own "Where is this used" list
// should know what is out of scope.
const SCOPE_CAVEAT: Caveat = {
  code: "scope",
  message: "Impact follows references, trigger and flow execution, permission grants and tracked dependencies. Field-level permissions and report or dashboard usage are not scanned.",
};

// Strongly connected components with more than one node, or a self-loop: the nodes on a cycle.
function cycleNodes(keys: string[], next: ReadonlyMap<string, string[]>): string[] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result = new Set<string>();

  // Recursion depth is bounded by IMPACT_NODE_CAP + 1.
  const visit = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of next.get(v) ?? []) {
      if (w === v) result.add(v);
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) component.forEach((k) => result.add(k));
    }
  };

  for (const k of keys) if (!index.has(k)) visit(k);
  return [...result].sort();
}

export class ImpactService {
  constructor(private readonly repo: GraphReadRepository) {}

  // Returns null when the node is not an active node of this connection.
  async analyze(connectionId: string, rootKey: string, options: { direction?: ImpactDirection; depth?: number } = {}): Promise<ImpactResult | null> {
    const direction = options.direction ?? "downstream";
    const depth = clamp(options.depth ?? DEFAULT_IMPACT_DEPTH, 1, MAX_IMPACT_DEPTH);

    const [root] = await this.repo.getNodes(connectionId, [rootKey]);
    if (!root) return null;

    const distance = new Map<string, number>([[root.nodeKey, 0]]);
    const found = new Map<string, StoredNode>([[root.nodeKey, root]]);
    const edges = new Map<string, StoredEdge>();
    let frontier: StoredNode[] = [root];
    let truncated = false;

    for (let ring = 1; ring <= depth && frontier.length > 0; ring++) {
      // downstream reads edges that point at the frontier, upstream the ones that leave it.
      const touching = await this.repo.edgesOf(
        connectionId,
        frontier.map((n) => n.nodeKey),
        { direction: direction === "downstream" ? "in" : "out", typeKeys: IMPACT_EDGE_TYPE_KEYS, limit: RING_EDGE_CAP }
      );
      if (touching.length >= RING_EDGE_CAP) truncated = true;
      for (const e of touching) edges.set(e.edgeKey, e);

      const neighbours = new Set<string>();
      for (const e of touching) {
        const other = direction === "downstream" ? e.sourceNodeKey : e.targetNodeKey;
        if (!distance.has(other)) neighbours.add(other);
      }
      // Stable order, so which nodes survive the cap does not change between calls.
      const room = IMPACT_NODE_CAP - (found.size - 1);
      const loaded = (await this.repo.getNodes(connectionId, [...neighbours])).sort((a, b) => (a.nodeKey < b.nodeKey ? -1 : a.nodeKey > b.nodeKey ? 1 : 0));
      if (loaded.length > room) truncated = true;
      const kept = loaded.slice(0, Math.max(0, room));
      for (const node of kept) {
        distance.set(node.nodeKey, ring);
        found.set(node.nodeKey, node);
      }
      frontier = kept;
    }

    // Keep only edges inside the discovered set, so nothing points at a node the client never got.
    const inside = [...edges.values()].filter((e) => found.has(e.sourceNodeKey) && found.has(e.targetNodeKey));
    const lookup = indexNodes(found.values());

    const forward = new Map<string, string[]>();
    for (const e of inside) {
      const from = direction === "downstream" ? e.targetNodeKey : e.sourceNodeKey;
      const to = direction === "downstream" ? e.sourceNodeKey : e.targetNodeKey;
      forward.set(from, [...(forward.get(from) ?? []), to]);
    }
    const onCycle = cycleNodes([...found.keys()].sort(), forward);

    const nodes: ImpactNode[] = [...found.values()]
      .filter((n) => n.nodeKey !== root.nodeKey)
      .map((n) => ({ ...toNodeDto(n), distance: distance.get(n.nodeKey)! }))
      .sort((a, b) => a.distance - b.distance || a.label.localeCompare(b.label) || (a.nodeKey < b.nodeKey ? -1 : 1));

    const counts = new Map<string, { kindLabel: string; count: number }>();
    for (const n of nodes) counts.set(n.typeKey, { kindLabel: n.kindLabel, count: (counts.get(n.typeKey)?.count ?? 0) + 1 });

    return {
      root: toNodeDto(root),
      direction,
      depth,
      nodes,
      edges: inside.map((e) => toEdgeDto(e, lookup)),
      summary: [...counts].map(([typeKey, v]) => ({ typeKey, ...v })).sort((a, b) => b.count - a.count || a.kindLabel.localeCompare(b.kindLabel)),
      truncated,
      hasCycle: onCycle.length > 0,
      cycleNodeKeys: onCycle,
      caveats: await this.caveats(connectionId, inside, truncated),
    };
  }

  private async caveats(connectionId: string, edges: StoredEdge[], truncated: boolean): Promise<Caveat[]> {
    const out: Caveat[] = [SCOPE_CAVEAT];
    const coverage = await this.repo.latestCoverage(connectionId);
    out.push(...coverageCaveats(coverage));
    if (edges.some((e) => e.confidence === "heuristic")) {
      out.push({ code: "heuristic", message: "Some links were inferred by matching names in Apex source, so they can include false positives." });
    }
    if (truncated) out.push({ code: "truncated", message: `Showing the first ${IMPACT_NODE_CAP} components; narrow the depth or pick a more specific node to see the rest.` });
    return out;
  }
}

export function coverageCaveats(coverage: GraphCoverage | null): Caveat[] {
  if (!coverage) return [{ code: "no-scan", message: "No scan has built the graph yet, so there is nothing to analyse." }];
  const weak = coverage.stages.filter((s) => s.coverage === "partial" || s.coverage === "degraded");
  return weak.map((s) => ({
    code: `coverage-${s.coverage}`,
    message: `${s.category.replace(/^graph_/, "").replace(/_/g, " ")} was ${s.coverage} in the last scan${s.detail ? ` (${s.detail})` : ""}, so results may be missing links.`,
  }));
}
