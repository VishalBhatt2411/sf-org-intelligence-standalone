import type { EdgeRow, GraphRepository, NodeRow, RetireResult, StoredRef } from "./graphRepository";
import type { EdgesOfOptions, GraphCoverage, GraphReadRepository, StoredEdge as ReadEdge, StoredNode as ReadNode, TypeCount } from "./graphReadRepository";
import type { EdgeScope, GraphState } from "./types";

type StoredNode = NodeRow & { state: GraphState; firstSeenScanId: string; lastSeenScanId: string };
type StoredEdge = EdgeRow & { state: GraphState; firstSeenScanId: string; lastSeenScanId: string };

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// Test double with the same semantics as the Prisma implementation, including the retire rules and the
// read queries (active rows only, per connection). A transaction is a snapshot that is discarded if the
// work throws.
export class InMemoryGraphRepository implements GraphRepository, GraphReadRepository {
  nodes = new Map<string, StoredNode>();
  edges = new Map<string, StoredEdge>();
  // What latestCoverage returns; tests set it directly.
  coverage = new Map<string, GraphCoverage>();
  // Counts of write operations, so tests can assert that unchanged rows are not rewritten.
  calls = { createNodes: 0, createEdges: 0, updateNodes: 0, updateEdges: 0, touchNodes: 0, touchEdges: 0 };

  private nk = (connectionId: string, key: string) => `${connectionId}\u0000${key}`;

  async transaction<T>(work: (repo: GraphRepository) => Promise<T>): Promise<T> {
    const nodes = new Map(this.nodes);
    const edges = new Map(this.edges);
    try {
      return await work(this);
    } catch (error) {
      this.nodes = nodes;
      this.edges = edges;
      throw error;
    }
  }

  async findNodes(connectionId: string, keys: string[]): Promise<StoredRef[]> {
    return keys.flatMap((k) => {
      const n = this.nodes.get(this.nk(connectionId, k));
      return n ? [{ key: k, checksum: n.checksum, state: n.state }] : [];
    });
  }

  async findEdges(connectionId: string, keys: string[]): Promise<StoredRef[]> {
    return keys.flatMap((k) => {
      const e = this.edges.get(this.nk(connectionId, k));
      return e ? [{ key: k, checksum: e.checksum, state: e.state }] : [];
    });
  }

  async createNodes(connectionId: string, scanId: string, rows: NodeRow[]): Promise<void> {
    this.calls.createNodes++;
    for (const r of rows) {
      const id = this.nk(connectionId, r.nodeKey);
      if (this.nodes.has(id)) throw new Error(`Unique constraint: node ${r.nodeKey}`);
      this.nodes.set(id, { ...r, state: "active", firstSeenScanId: scanId, lastSeenScanId: scanId });
    }
  }

  async createEdges(connectionId: string, scanId: string, rows: EdgeRow[]): Promise<void> {
    this.calls.createEdges++;
    for (const r of rows) {
      const id = this.nk(connectionId, r.edgeKey);
      if (this.edges.has(id)) throw new Error(`Unique constraint: edge ${r.edgeKey}`);
      this.edges.set(id, { ...r, state: "active", firstSeenScanId: scanId, lastSeenScanId: scanId });
    }
  }

  async updateNodes(connectionId: string, scanId: string, rows: NodeRow[]): Promise<void> {
    this.calls.updateNodes++;
    for (const r of rows) {
      const id = this.nk(connectionId, r.nodeKey);
      const current = this.nodes.get(id);
      if (!current) throw new Error(`Record not found: node ${r.nodeKey}`);
      this.nodes.set(id, { ...r, state: "active", firstSeenScanId: current.firstSeenScanId, lastSeenScanId: scanId });
    }
  }

  async updateEdges(connectionId: string, scanId: string, rows: EdgeRow[]): Promise<void> {
    this.calls.updateEdges++;
    for (const r of rows) {
      const id = this.nk(connectionId, r.edgeKey);
      const current = this.edges.get(id);
      if (!current) throw new Error(`Record not found: edge ${r.edgeKey}`);
      this.edges.set(id, { ...r, state: "active", firstSeenScanId: current.firstSeenScanId, lastSeenScanId: scanId });
    }
  }

  async touchNodes(connectionId: string, scanId: string, keys: string[]): Promise<void> {
    this.calls.touchNodes++;
    for (const k of keys) {
      const n = this.nodes.get(this.nk(connectionId, k));
      if (n) Object.assign(n, { state: "active", lastSeenScanId: scanId });
    }
  }

  async touchEdges(connectionId: string, scanId: string, keys: string[]): Promise<void> {
    this.calls.touchEdges++;
    for (const k of keys) {
      const e = this.edges.get(this.nk(connectionId, k));
      if (e) Object.assign(e, { state: "active", lastSeenScanId: scanId });
    }
  }

  async retire(connectionId: string, scanId: string, nodeTypeKeys: string[], edgeScopes: EdgeScope[]): Promise<RetireResult> {
    let nodes = 0;
    let edges = 0;
    const types = new Set(nodeTypeKeys);
    const mine = <T extends { state: GraphState; lastSeenScanId: string }>(row: T) => row.state === "active" && row.lastSeenScanId !== scanId;

    for (const [id, n] of this.nodes) {
      if (id.startsWith(`${connectionId}\u0000`) && mine(n) && types.has(n.typeKey)) {
        n.state = "stale";
        nodes++;
      }
    }
    for (const [id, e] of this.edges) {
      if (!id.startsWith(`${connectionId}\u0000`) || !mine(e)) continue;
      const inScope = edgeScopes.some((s) => {
        if (s.typeKey !== e.typeKey) return false;
        if (s.sourceTypeKey === null) return true;
        return this.nodes.get(this.nk(connectionId, e.sourceNodeKey))?.typeKey === s.sourceTypeKey;
      });
      if (inScope) {
        e.state = "stale";
        edges++;
      }
    }
    if (nodes > 0) {
      for (const [id, e] of this.edges) {
        if (!id.startsWith(`${connectionId}\u0000`) || e.state !== "active") continue;
        const dead = (key: string) => this.nodes.get(this.nk(connectionId, key))?.state === "stale";
        if (dead(e.sourceNodeKey) || dead(e.targetNodeKey)) {
          e.state = "stale";
          edges++;
        }
      }
    }
    return { nodes, edges };
  }

  private mine<T extends { state: GraphState }>(map: Map<string, T>, connectionId: string): T[] {
    const prefix = `${connectionId}\u0000`;
    return [...map].filter(([id, row]) => id.startsWith(prefix) && row.state === "active").map(([, row]) => row);
  }

  private readNode = (n: StoredNode): ReadNode => ({ nodeKey: n.nodeKey, typeKey: n.typeKey, label: n.label, fqn: n.fqn, namespace: n.namespace, parentKey: n.parentKey, attributes: { ...n.attributes }, checksum: n.checksum });

  async getNodes(connectionId: string, keys: string[]): Promise<ReadNode[]> {
    const wanted = new Set(keys);
    return this.mine(this.nodes, connectionId).filter((n) => wanted.has(n.nodeKey)).map(this.readNode);
  }

  async edgesOf(connectionId: string, nodeKeys: string[], options: EdgesOfOptions): Promise<ReadEdge[]> {
    const wanted = new Set(nodeKeys);
    const types = options.typeKeys ? new Set(options.typeKeys) : null;
    return this.mine(this.edges, connectionId)
      .filter((e) => (!types || types.has(e.typeKey)) && ((options.direction !== "in" && wanted.has(e.sourceNodeKey)) || (options.direction !== "out" && wanted.has(e.targetNodeKey))))
      .sort((a, b) => byText(a.edgeKey, b.edgeKey))
      .slice(0, options.limit)
      .map((e) => ({ edgeKey: e.edgeKey, typeKey: e.typeKey, sourceNodeKey: e.sourceNodeKey, targetNodeKey: e.targetNodeKey, confidence: e.confidence, attributes: { ...e.attributes }, checksum: e.checksum }));
  }

  async searchNodes(connectionId: string, prefix: string, limit: number): Promise<ReadNode[]> {
    const p = prefix.toLowerCase();
    return this.mine(this.nodes, connectionId)
      .filter((n) => n.label.toLowerCase().startsWith(p) || n.fqn.toLowerCase().startsWith(p))
      .sort((a, b) => byText(a.label, b.label) || byText(a.nodeKey, b.nodeKey))
      .slice(0, limit)
      .map(this.readNode);
  }

  async browseNodes(connectionId: string, typeKey: string, limit: number): Promise<ReadNode[]> {
    return this.mine(this.nodes, connectionId)
      .filter((n) => n.typeKey === typeKey)
      .sort((a, b) => byText(a.label, b.label) || byText(a.nodeKey, b.nodeKey))
      .slice(0, limit)
      .map(this.readNode);
  }

  private count(rows: Array<{ typeKey: string }>): TypeCount[] {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.typeKey, (counts.get(r.typeKey) ?? 0) + 1);
    return [...counts].map(([typeKey, count]) => ({ typeKey, count }));
  }

  async countNodesByType(connectionId: string): Promise<TypeCount[]> {
    return this.count(this.mine(this.nodes, connectionId));
  }

  async countEdgesByType(connectionId: string): Promise<TypeCount[]> {
    return this.count(this.mine(this.edges, connectionId));
  }

  async latestCoverage(connectionId: string): Promise<GraphCoverage | null> {
    return this.coverage.get(connectionId) ?? null;
  }
}
