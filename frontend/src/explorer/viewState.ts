import type { GraphEdge, GraphNode, RingNode, UnchangedNode } from "./graphApi";

// Explorer view state. The canvas shows what the user has expanded from a focus node; every expansion
// "supports" the neighbours it brought in. A node stays visible while some visible node's expansion
// supports it, so collapsing one branch never removes a node another branch still reaches (the diamond
// case). Visibility is derived by reachability from the root rather than by counting references, so two
// nodes that only support each other cannot keep each other alive after their common ancestor collapses.

export type Expansion = {
  // Neighbours this owner's expansion brought in (never the owner itself).
  nodeKeys: string[];
  edgeKeys: string[];
  nextCursor: string | null;
  truncated: boolean;
};

export type ViewState = {
  rootKey: string | null;
  // Everything fetched so far, kept after a collapse so re-expanding can send checksums instead of payloads.
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
  expansions: Record<string, Expansion>;
  selectedKey: string | null;
  // Focus history for the breadcrumb, oldest first; the last entry is the current root.
  trail: string[];
};

export const initialViewState: ViewState = { rootKey: null, nodes: {}, edges: {}, expansions: {}, selectedKey: null, trail: [] };

export type ViewAction =
  | { type: "focus"; node: GraphNode }
  | { type: "expanded"; owner: string; nodes: Array<RingNode | UnchangedNode>; edges: GraphEdge[]; nextCursor: string | null; truncated: boolean; append?: boolean }
  | { type: "collapse"; owner: string }
  | { type: "select"; key: string | null }
  | { type: "trailTo"; index: number }
  | { type: "clear" };

export type VisibleNode = GraphNode & { ring: number };
export type VisibleGraph = { nodes: VisibleNode[]; edges: GraphEdge[] };

const isUnchanged = (n: RingNode | UnchangedNode): n is UnchangedNode => "unchanged" in n && n.unchanged === true;

// Breadth-first from the root through expansions of visible owners; ring is the shortest path length.
function reachableRings(state: ViewState): Map<string, number> {
  const rings = new Map<string, number>();
  if (!state.rootKey || !state.nodes[state.rootKey]) return rings;
  rings.set(state.rootKey, 0);
  const queue = [state.rootKey];
  for (let i = 0; i < queue.length; i++) {
    const owner = queue[i];
    const expansion = state.expansions[owner];
    if (!expansion) continue;
    const ring = rings.get(owner)! + 1;
    for (const key of expansion.nodeKeys) {
      if (rings.has(key) || !state.nodes[key]) continue;
      rings.set(key, ring);
      queue.push(key);
    }
  }
  return rings;
}

export function visibleGraph(state: ViewState): VisibleGraph {
  const rings = reachableRings(state);
  const nodes: VisibleNode[] = [];
  for (const [key, ring] of rings) nodes.push({ ...state.nodes[key], ring });
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const owner of rings.keys()) {
    for (const edgeKey of state.expansions[owner]?.edgeKeys ?? []) {
      if (seen.has(edgeKey)) continue;
      const edge = state.edges[edgeKey];
      if (edge && rings.has(edge.source) && rings.has(edge.target)) {
        seen.add(edgeKey);
        edges.push(edge);
      }
    }
  }
  return { nodes, edges };
}

export const isExpanded = (state: ViewState, key: string): boolean => key in state.expansions;

// Checksums of nodes held but not on screen: what the next expand request can skip re-sending.
export function knownChecksums(state: ViewState, limit = 200): string[] {
  const visible = reachableRings(state);
  const out: string[] = [];
  for (const [key, node] of Object.entries(state.nodes)) {
    if (visible.has(key)) continue;
    out.push(node.checksum);
    if (out.length >= limit) break;
  }
  return out;
}

// Drops expansions whose owner is no longer on screen, so a collapsed branch leaves nothing behind.
function prune(state: ViewState): ViewState {
  const rings = reachableRings(state);
  const expansions: Record<string, Expansion> = {};
  for (const [owner, expansion] of Object.entries(state.expansions)) if (rings.has(owner)) expansions[owner] = expansion;
  const selectedKey = state.selectedKey && rings.has(state.selectedKey) ? state.selectedKey : state.rootKey;
  return { ...state, expansions, selectedKey };
}

export function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case "focus": {
      const key = action.node.nodeKey;
      const at = state.trail.indexOf(key);
      const trail = at >= 0 ? state.trail.slice(0, at + 1) : [...state.trail, key];
      return { ...state, rootKey: key, nodes: { ...state.nodes, [key]: action.node }, expansions: {}, selectedKey: key, trail };
    }
    case "expanded": {
      const nodes = { ...state.nodes };
      const edges = { ...state.edges };
      const nodeKeys: string[] = [];
      for (const n of action.nodes) {
        if (n.nodeKey === action.owner) {
          if (!isUnchanged(n)) nodes[n.nodeKey] = stripRing(n);
          continue;
        }
        if (isUnchanged(n)) {
          if (!nodes[n.nodeKey]) continue;
        } else {
          nodes[n.nodeKey] = stripRing(n);
        }
        nodeKeys.push(n.nodeKey);
      }
      const edgeKeys: string[] = [];
      for (const e of action.edges) {
        edges[e.edgeKey] = e;
        edgeKeys.push(e.edgeKey);
      }
      const previous = action.append ? state.expansions[action.owner] : undefined;
      const merged: Expansion = {
        nodeKeys: previous ? [...new Set([...previous.nodeKeys, ...nodeKeys])] : nodeKeys,
        edgeKeys: previous ? [...new Set([...previous.edgeKeys, ...edgeKeys])] : edgeKeys,
        nextCursor: action.nextCursor,
        truncated: action.truncated || (previous?.truncated ?? false),
      };
      return { ...state, nodes, edges, expansions: { ...state.expansions, [action.owner]: merged } };
    }
    case "collapse": {
      if (!(action.owner in state.expansions)) return state;
      const { [action.owner]: _removed, ...rest } = state.expansions;
      return prune({ ...state, expansions: rest });
    }
    case "select":
      return state.selectedKey === action.key ? state : { ...state, selectedKey: action.key };
    case "trailTo": {
      const key = state.trail[action.index];
      const node = key ? state.nodes[key] : undefined;
      if (!node) return state;
      return { ...state, rootKey: key, expansions: {}, selectedKey: key, trail: state.trail.slice(0, action.index + 1) };
    }
    case "clear":
      return initialViewState;
  }
}

function stripRing(node: RingNode): GraphNode {
  const { ring: _ring, ...rest } = node;
  return rest;
}
