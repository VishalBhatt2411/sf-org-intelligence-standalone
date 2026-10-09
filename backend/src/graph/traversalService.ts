import { clamp, GraphInputError } from "./errors";
import { indexNodes, toEdgeDto, toNodeDto, type EdgeDto, type NodeDto } from "./graphDto";
import type { GraphReadRepository, StoredEdge, StoredNode } from "./graphReadRepository";

export const DEFAULT_HOPS = 1;
export const MAX_HOPS = 3;
export const EXPAND_DEFAULT_PAGE = 200;
// Hard cap on nodes in one response, however many hops were asked for.
export const EXPAND_NODE_CAP = 500;
// Most edges read for one ring. A hub with more neighbours than this is reported as truncated
// instead of being walked to the end.
export const RING_EDGE_CAP = 5000;
export const MAX_KNOWN_CHECKSUMS = 200;

export type RingNode = NodeDto & { ring: number };
// A node the client already holds at this checksum: identity and ring only, no payload.
export type UnchangedNode = { nodeKey: string; checksum: string; ring: number; unchanged: true };

export type ExpandResult = {
  root: string;
  hops: number;
  nodes: Array<RingNode | UnchangedNode>;
  edges: EdgeDto[];
  // Opaque token for the next page, or null when this was the last page.
  nextCursor: string | null;
  // True when a ring had more edges than RING_EDGE_CAP, so the neighbourhood is incomplete.
  truncated: boolean;
};

// `edgeTypes` (edge type keys) restricts which edges the walk follows. Object mode uses it to follow only
// the structural relationship edges, so unrelated neighbours (permission sets, flows) cannot crowd the
// relationship fields out of a capped page.
export type ExpandOptions = { hops?: number; cursor?: string; limit?: number; known?: string[]; edgeTypes?: string[] };

type Entry = { node: StoredNode; ring: number };

const CURSOR_PATTERN = /^([1-9]):([0-9a-f]{64})$/;

// Entries are ordered by ring, then node key, which is a total order, so a cursor is just "the last
// entry you saw" (keyset pagination) and re-running the walk reproduces the same sequence.
const after = (entry: { ring: number; key: string }, cursor: { ring: number; key: string }) =>
  entry.ring > cursor.ring || (entry.ring === cursor.ring && entry.key > cursor.key);

function parseCursor(cursor: string | undefined, hops: number): { ring: number; key: string } | null {
  if (cursor === undefined || cursor === "") return null;
  const match = CURSOR_PATTERN.exec(cursor);
  if (!match || Number(match[1]) > hops) throw new GraphInputError("Invalid cursor");
  return { ring: Number(match[1]), key: match[2] };
}

// Undirected breadth-first expansion around one node, ring by ring. Rings are loaded lazily and the
// walk stops as soon as the requested page is full, so expanding a hub never reads its whole
// neighbourhood. Structural and impact edges are both followed: this is for exploring, not for impact.
export class TraversalService {
  constructor(private readonly repo: GraphReadRepository) {}

  // Returns null when the root is not an active node of this connection.
  async expand(connectionId: string, rootKey: string, options: ExpandOptions = {}): Promise<ExpandResult | null> {
    const hops = clamp(options.hops ?? DEFAULT_HOPS, 1, MAX_HOPS);
    const limit = clamp(options.limit ?? EXPAND_DEFAULT_PAGE, 1, EXPAND_NODE_CAP);
    const cursor = parseCursor(options.cursor, hops);
    const known = new Set(options.known ?? []);
    const edgeTypes = options.edgeTypes?.length ? options.edgeTypes : undefined;
    if (known.size > MAX_KNOWN_CHECKSUMS) throw new GraphInputError(`known is limited to ${MAX_KNOWN_CHECKSUMS} checksums`);

    const [root] = await this.repo.getNodes(connectionId, [rootKey]);
    if (!root) return null;

    const seen = new Set<string>([root.nodeKey]);
    const entries: Entry[] = [];
    const edges = new Map<string, StoredEdge>();
    let frontier: StoredNode[] = [root];
    let truncated = false;
    let beyondCursor = 0;

    for (let ring = 1; ring <= hops && frontier.length > 0; ring++) {
      const found = await this.repo.edgesOf(
        connectionId,
        frontier.map((n) => n.nodeKey),
        { direction: "both", limit: RING_EDGE_CAP, ...(edgeTypes ? { typeKeys: edgeTypes } : {}) }
      );
      if (found.length >= RING_EDGE_CAP) truncated = true;
      for (const e of found) edges.set(e.edgeKey, e);

      const inFrontier = new Set(frontier.map((n) => n.nodeKey));
      const next = new Set<string>();
      for (const e of found) {
        for (const key of [e.sourceNodeKey, e.targetNodeKey]) if (!inFrontier.has(key) && !seen.has(key)) next.add(key);
      }
      const nodes = (await this.repo.getNodes(connectionId, [...next])).sort((a, b) => (a.nodeKey < b.nodeKey ? -1 : a.nodeKey > b.nodeKey ? 1 : 0));
      for (const node of nodes) {
        seen.add(node.nodeKey);
        entries.push({ node, ring });
        if (!cursor || after({ ring, key: node.nodeKey }, cursor)) beyondCursor++;
      }
      frontier = nodes;
      // The page (plus one entry that proves there is a next page) is already full: deeper rings
      // cannot change it, so do not read them.
      if (beyondCursor > limit) break;
    }

    const remaining = entries.filter((e) => !cursor || after({ ring: e.ring, key: e.node.nodeKey }, cursor));
    const page = remaining.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = remaining.length > page.length && last ? `${last.ring}:${last.node.nodeKey}` : null;

    // Everything up to the end of this page is on the client's canvas once it applies the response.
    const visible = new Map<string, StoredNode>([[root.nodeKey, root]]);
    const pageKeys = new Set<string>(cursor ? [] : [root.nodeKey]);
    const pageEnd = last ?? null;
    for (const e of entries) {
      if (pageEnd && (e.ring > pageEnd.ring || (e.ring === pageEnd.ring && e.node.nodeKey > pageEnd.node.nodeKey))) break;
      visible.set(e.node.nodeKey, e.node);
    }
    for (const e of page) pageKeys.add(e.node.nodeKey);

    const toWire = (node: StoredNode, ring: number): RingNode | UnchangedNode =>
      known.has(node.checksum) ? { nodeKey: node.nodeKey, checksum: node.checksum, ring, unchanged: true } : { ...toNodeDto(node), ring };

    const lookup = indexNodes(visible.values());
    return {
      root: root.nodeKey,
      hops,
      nodes: [...(cursor ? [] : [toWire(root, 0)]), ...page.map((e) => toWire(e.node, e.ring))],
      // An edge belongs to the page that introduces its newer end, so each edge is sent once.
      edges: [...edges.values()]
        .filter((e) => lookup.has(e.sourceNodeKey) && lookup.has(e.targetNodeKey) && (pageKeys.has(e.sourceNodeKey) || pageKeys.has(e.targetNodeKey)))
        .map((e) => toEdgeDto(e, lookup)),
      nextCursor,
      truncated,
    };
  }
}
