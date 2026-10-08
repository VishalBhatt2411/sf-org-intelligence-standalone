import { Prisma, type PrismaClient } from "@prisma/client";
import { chunked } from "../graph/graphRepository";
import { PrismaGraphReadRepository, type GraphReadRepository } from "../graph/graphReadRepository";
import type { InMemoryGraphRepository } from "../graph/inMemoryGraphRepository";

// The aggregate questions Org Health asks of the graph tables. They are counts and pair lists, never
// the edge rows themselves, so a section stays cheap on a large org. Every method is scoped to one
// connection and sees active rows only. Nothing here writes.

export type Neighbours = { out: number; in: number };

export interface HealthGraphRepository extends Pick<GraphReadRepository, "browseNodes" | "getNodes" | "countNodesByType" | "countEdgesByType" | "latestCoverage"> {
  // Custom fields (API name ending __c) per parent object key.
  customFieldCounts(connectionId: string, objectKeys: string[]): Promise<Map<string, number>>;
  // Distinct nodes pointing at each target through any of the edge types.
  incomingCounts(connectionId: string, targetKeys: string[], edgeTypeKeys: string[]): Promise<Map<string, number>>;
  // Distinct partner nodes per node, outgoing and incoming, through any of the edge types.
  neighbourCounts(connectionId: string, nodeKeys: string[], edgeTypeKeys: string[]): Promise<Map<string, Neighbours>>;
  // [source, target] pairs of edges whose two ends are both in nodeKeys.
  edgesAmong(connectionId: string, nodeKeys: string[], edgeTypeKeys: string[]): Promise<Array<[string, string]>>;
  // For the given source nodes, how many of them execute on each target (EXECUTES_ON), keyed by target.
  executionTargets(connectionId: string, sourceKeys: string[], edgeTypeKey: string): Promise<Map<string, number>>;
}

const CHUNK = 500;
const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);

export class PrismaHealthGraphRepository implements HealthGraphRepository {
  private reader: PrismaGraphReadRepository;
  constructor(private db: PrismaClient) {
    this.reader = new PrismaGraphReadRepository(db);
  }

  browseNodes: HealthGraphRepository["browseNodes"] = (c, t, l) => this.reader.browseNodes(c, t, l);
  getNodes: HealthGraphRepository["getNodes"] = (c, k) => this.reader.getNodes(c, k);
  countNodesByType: HealthGraphRepository["countNodesByType"] = (c) => this.reader.countNodesByType(c);
  countEdgesByType: HealthGraphRepository["countEdgesByType"] = (c) => this.reader.countEdgesByType(c);
  latestCoverage: HealthGraphRepository["latestCoverage"] = (c) => this.reader.latestCoverage(c);

  async customFieldCounts(connectionId: string, objectKeys: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const part of chunked(objectKeys, CHUNK)) {
      // `_` is a LIKE wildcard, hence the escapes: the pattern means "ends with the two characters __c".
      const rows = await this.db.$queryRaw<Array<{ parentKey: string; n: bigint }>>`
        SELECT parent_key AS "parentKey", COUNT(*) AS n
        FROM graph_nodes
        WHERE connection_id = ${connectionId} AND state = 'active' AND type_key = 'SalesforceMetadata.CustomField'
          AND parent_key IN (${Prisma.join(part)}) AND fqn ILIKE ${"%\\_\\_c"}
        GROUP BY parent_key`;
      for (const r of rows) add(out, r.parentKey, Number(r.n));
    }
    return out;
  }

  async incomingCounts(connectionId: string, targetKeys: string[], edgeTypeKeys: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (edgeTypeKeys.length === 0) return out;
    for (const part of chunked(targetKeys, CHUNK)) {
      const rows = await this.db.$queryRaw<Array<{ key: string; n: bigint }>>`
        SELECT target_node_key AS key, COUNT(DISTINCT source_node_key) AS n
        FROM graph_edges
        WHERE connection_id = ${connectionId} AND state = 'active' AND type_key IN (${Prisma.join(edgeTypeKeys)})
          AND target_node_key IN (${Prisma.join(part)})
        GROUP BY target_node_key`;
      for (const r of rows) add(out, r.key, Number(r.n));
    }
    return out;
  }

  async neighbourCounts(connectionId: string, nodeKeys: string[], edgeTypeKeys: string[]): Promise<Map<string, Neighbours>> {
    const out = new Map<string, Neighbours>();
    if (edgeTypeKeys.length === 0) return out;
    const slot = (k: string) => out.get(k) ?? out.set(k, { out: 0, in: 0 }).get(k)!;
    for (const part of chunked(nodeKeys, CHUNK)) {
      const outgoing = await this.db.$queryRaw<Array<{ key: string; n: bigint }>>`
        SELECT source_node_key AS key, COUNT(DISTINCT target_node_key) AS n
        FROM graph_edges
        WHERE connection_id = ${connectionId} AND state = 'active' AND type_key IN (${Prisma.join(edgeTypeKeys)})
          AND source_node_key IN (${Prisma.join(part)})
        GROUP BY source_node_key`;
      for (const r of outgoing) slot(r.key).out = Number(r.n);
      const incoming = await this.db.$queryRaw<Array<{ key: string; n: bigint }>>`
        SELECT target_node_key AS key, COUNT(DISTINCT source_node_key) AS n
        FROM graph_edges
        WHERE connection_id = ${connectionId} AND state = 'active' AND type_key IN (${Prisma.join(edgeTypeKeys)})
          AND target_node_key IN (${Prisma.join(part)})
        GROUP BY target_node_key`;
      for (const r of incoming) slot(r.key).in = Number(r.n);
    }
    return out;
  }

  async edgesAmong(connectionId: string, nodeKeys: string[], edgeTypeKeys: string[]): Promise<Array<[string, string]>> {
    if (edgeTypeKeys.length === 0) return [];
    const wanted = new Set(nodeKeys);
    const seen = new Set<string>();
    const out: Array<[string, string]> = [];
    // Chunk by source; the target filter is applied here so no query needs a huge IN list on both ends.
    for (const part of chunked(nodeKeys, CHUNK)) {
      const rows = await this.db.graphEdge.findMany({
        where: { connectionId, state: "active", typeKey: { in: edgeTypeKeys }, sourceNodeKey: { in: part } },
        select: { sourceNodeKey: true, targetNodeKey: true },
      });
      for (const r of rows) {
        const id = `${r.sourceNodeKey}\u0000${r.targetNodeKey}`;
        if (wanted.has(r.targetNodeKey) && !seen.has(id)) {
          seen.add(id);
          out.push([r.sourceNodeKey, r.targetNodeKey]);
        }
      }
    }
    return out;
  }

  async executionTargets(connectionId: string, sourceKeys: string[], edgeTypeKey: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const part of chunked(sourceKeys, CHUNK)) {
      const rows = await this.db.$queryRaw<Array<{ key: string; n: bigint }>>`
        SELECT target_node_key AS key, COUNT(DISTINCT source_node_key) AS n
        FROM graph_edges
        WHERE connection_id = ${connectionId} AND state = 'active' AND type_key = ${edgeTypeKey}
          AND source_node_key IN (${Prisma.join(part)})
        GROUP BY target_node_key`;
      for (const r of rows) add(out, r.key, Number(r.n));
    }
    return out;
  }
}

// Test double over the in-memory graph, with the same semantics as the SQL above.
export class InMemoryHealthGraph implements HealthGraphRepository {
  constructor(private graph: InMemoryGraphRepository) {}

  browseNodes: HealthGraphRepository["browseNodes"] = (c, t, l) => this.graph.browseNodes(c, t, l);
  getNodes: HealthGraphRepository["getNodes"] = (c, k) => this.graph.getNodes(c, k);
  countNodesByType: HealthGraphRepository["countNodesByType"] = (c) => this.graph.countNodesByType(c);
  countEdgesByType: HealthGraphRepository["countEdgesByType"] = (c) => this.graph.countEdgesByType(c);
  latestCoverage: HealthGraphRepository["latestCoverage"] = (c) => this.graph.latestCoverage(c);

  private activeEdges(connectionId: string, typeKeys: string[]) {
    const types = new Set(typeKeys);
    return [...this.graph.edges]
      .filter(([id, e]) => id.startsWith(`${connectionId}\u0000`) && e.state === "active" && types.has(e.typeKey))
      .map(([, e]) => e);
  }

  async customFieldCounts(connectionId: string, objectKeys: string[]): Promise<Map<string, number>> {
    const wanted = new Set(objectKeys);
    const out = new Map<string, number>();
    for (const [id, n] of this.graph.nodes) {
      if (!id.startsWith(`${connectionId}\u0000`) || n.state !== "active" || n.typeKey !== "SalesforceMetadata.CustomField") continue;
      if (n.parentKey && wanted.has(n.parentKey) && /__c$/i.test(n.fqn)) add(out, n.parentKey, 1);
    }
    return out;
  }

  async incomingCounts(connectionId: string, targetKeys: string[], edgeTypeKeys: string[]): Promise<Map<string, number>> {
    const wanted = new Set(targetKeys);
    const sources = new Map<string, Set<string>>();
    for (const e of this.activeEdges(connectionId, edgeTypeKeys)) {
      if (wanted.has(e.targetNodeKey)) (sources.get(e.targetNodeKey) ?? sources.set(e.targetNodeKey, new Set()).get(e.targetNodeKey)!).add(e.sourceNodeKey);
    }
    return new Map([...sources].map(([k, v]) => [k, v.size]));
  }

  async neighbourCounts(connectionId: string, nodeKeys: string[], edgeTypeKeys: string[]): Promise<Map<string, Neighbours>> {
    const wanted = new Set(nodeKeys);
    const outgoing = new Map<string, Set<string>>();
    const incoming = new Map<string, Set<string>>();
    const put = (m: Map<string, Set<string>>, k: string, v: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v);
    for (const e of this.activeEdges(connectionId, edgeTypeKeys)) {
      if (wanted.has(e.sourceNodeKey)) put(outgoing, e.sourceNodeKey, e.targetNodeKey);
      if (wanted.has(e.targetNodeKey)) put(incoming, e.targetNodeKey, e.sourceNodeKey);
    }
    const out = new Map<string, Neighbours>();
    for (const k of new Set([...outgoing.keys(), ...incoming.keys()])) out.set(k, { out: outgoing.get(k)?.size ?? 0, in: incoming.get(k)?.size ?? 0 });
    return out;
  }

  async edgesAmong(connectionId: string, nodeKeys: string[], edgeTypeKeys: string[]): Promise<Array<[string, string]>> {
    const wanted = new Set(nodeKeys);
    const seen = new Set<string>();
    const out: Array<[string, string]> = [];
    for (const e of this.activeEdges(connectionId, edgeTypeKeys)) {
      const id = `${e.sourceNodeKey}\u0000${e.targetNodeKey}`;
      if (wanted.has(e.sourceNodeKey) && wanted.has(e.targetNodeKey) && !seen.has(id)) {
        seen.add(id);
        out.push([e.sourceNodeKey, e.targetNodeKey]);
      }
    }
    return out;
  }

  async executionTargets(connectionId: string, sourceKeys: string[], edgeTypeKey: string): Promise<Map<string, number>> {
    const wanted = new Set(sourceKeys);
    const pairs = new Map<string, Set<string>>();
    for (const e of this.activeEdges(connectionId, [edgeTypeKey])) {
      if (wanted.has(e.sourceNodeKey)) (pairs.get(e.targetNodeKey) ?? pairs.set(e.targetNodeKey, new Set()).get(e.targetNodeKey)!).add(e.sourceNodeKey);
    }
    return new Map([...pairs].map(([k, v]) => [k, v.size]));
  }
}
