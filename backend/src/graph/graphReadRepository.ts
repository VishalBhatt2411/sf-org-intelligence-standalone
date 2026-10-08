import { Prisma, type PrismaClient } from "@prisma/client";
import { chunked } from "./graphRepository";
import type { Confidence, Coverage } from "./types";

// Read side of the graph tables. Separate from GraphRepository (the write side the builder uses) so the
// read services depend on a small query surface and never on Prisma. Every method is scoped to one
// connection and returns active rows only: stale rows are history, not part of the live graph.

export type StoredNode = {
  nodeKey: string;
  typeKey: string;
  label: string;
  fqn: string;
  namespace: string | null;
  parentKey: string | null;
  attributes: Record<string, unknown>;
  checksum: string;
};

export type StoredEdge = {
  edgeKey: string;
  typeKey: string;
  sourceNodeKey: string;
  targetNodeKey: string;
  confidence: Confidence;
  attributes: Record<string, unknown>;
  checksum: string;
};

export type EdgeDirection = "out" | "in" | "both";
export type EdgesOfOptions = { direction: EdgeDirection; typeKeys?: readonly string[]; limit: number };
export type TypeCount = { typeKey: string; count: number };

export type StageCoverage = { category: string; coverage: Coverage | null; detail: string | null; itemCount: number };
export type GraphCoverage = { scanId: string; finishedAt: Date | null; stages: StageCoverage[] };

export interface GraphReadRepository {
  getNodes(connectionId: string, keys: string[]): Promise<StoredNode[]>;
  // Active edges incident to any of the nodes (in the given direction), ordered by edgeKey, at most `limit`.
  // Retire marks an edge stale as soon as either endpoint is stale, so an active edge has active ends.
  edgesOf(connectionId: string, nodeKeys: string[], options: EdgesOfOptions): Promise<StoredEdge[]>;
  // Case-insensitive prefix match on label or fqn, ordered by label.
  searchNodes(connectionId: string, prefix: string, limit: number): Promise<StoredNode[]>;
  browseNodes(connectionId: string, typeKey: string, limit: number): Promise<StoredNode[]>;
  countNodesByType(connectionId: string): Promise<TypeCount[]>;
  countEdgesByType(connectionId: string): Promise<TypeCount[]>;
  // Graph-stage coverage of the most recent finished scan that ran the graph stage, or null.
  latestCoverage(connectionId: string): Promise<GraphCoverage | null>;
}

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const asConfidence = (value: string): Confidence => (value === "exact" || value === "parsed" ? value : "heuristic");
const asCoverage = (value: string | null): Coverage | null => (value === "complete" || value === "partial" || value === "degraded" ? value : null);

const NODE_SELECT = { nodeKey: true, typeKey: true, label: true, fqn: true, namespace: true, parentKey: true, attributes: true, checksum: true } as const;

type NodeRecord = { nodeKey: string; typeKey: string; label: string; fqn: string; namespace: string | null; parentKey: string | null; attributes: unknown; checksum: string };
const toNode = (r: NodeRecord): StoredNode => ({ ...r, attributes: asRecord(r.attributes) });

// LIKE treats % and _ as wildcards; a user typing "Invoice_" means the underscore.
export const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export class PrismaGraphReadRepository implements GraphReadRepository {
  constructor(private readonly db: PrismaClient) {}

  async getNodes(connectionId: string, keys: string[]): Promise<StoredNode[]> {
    const out: StoredNode[] = [];
    for (const part of chunked(keys)) {
      const rows = await this.db.graphNode.findMany({ where: { connectionId, state: "active", nodeKey: { in: part } }, select: NODE_SELECT });
      out.push(...rows.map(toNode));
    }
    return out;
  }

  async edgesOf(connectionId: string, nodeKeys: string[], options: EdgesOfOptions): Promise<StoredEdge[]> {
    const byKey = new Map<string, StoredEdge>();
    for (const part of chunked(nodeKeys)) {
      const ends: Prisma.GraphEdgeWhereInput[] = [];
      if (options.direction !== "in") ends.push({ sourceNodeKey: { in: part } });
      if (options.direction !== "out") ends.push({ targetNodeKey: { in: part } });
      const rows = await this.db.graphEdge.findMany({
        where: { connectionId, state: "active", OR: ends, ...(options.typeKeys ? { typeKey: { in: [...options.typeKeys] } } : {}) },
        orderBy: { edgeKey: "asc" },
        take: options.limit,
        select: { edgeKey: true, typeKey: true, sourceNodeKey: true, targetNodeKey: true, confidence: true, attributes: true, checksum: true },
      });
      for (const r of rows) byKey.set(r.edgeKey, { ...r, confidence: asConfidence(r.confidence), attributes: asRecord(r.attributes) });
    }
    // Each chunk was ordered and capped on its own; merge so the result is globally ordered and capped.
    return [...byKey.values()].sort((a, b) => (a.edgeKey < b.edgeKey ? -1 : a.edgeKey > b.edgeKey ? 1 : 0)).slice(0, options.limit);
  }

  // Raw SQL so the predicate is lower(col) LIKE 'prefix%', which the text_pattern_ops partial indexes
  // from the graph migration serve; Prisma's `startsWith` + insensitive mode would not use them.
  async searchNodes(connectionId: string, prefix: string, limit: number): Promise<StoredNode[]> {
    const pattern = `${escapeLike(prefix.toLowerCase())}%`;
    const rows = await this.db.$queryRaw<NodeRecord[]>`
      SELECT node_key AS "nodeKey", type_key AS "typeKey", label, fqn, namespace, parent_key AS "parentKey", attributes, checksum
      FROM graph_nodes
      WHERE connection_id = ${connectionId} AND state = 'active'
        AND (lower(label) LIKE ${pattern} OR lower(fqn) LIKE ${pattern})
      ORDER BY label, node_key
      LIMIT ${limit}`;
    return rows.map(toNode);
  }

  async browseNodes(connectionId: string, typeKey: string, limit: number): Promise<StoredNode[]> {
    const rows = await this.db.graphNode.findMany({
      where: { connectionId, state: "active", typeKey },
      orderBy: [{ label: "asc" }, { nodeKey: "asc" }],
      take: limit,
      select: NODE_SELECT,
    });
    return rows.map(toNode);
  }

  async countNodesByType(connectionId: string): Promise<TypeCount[]> {
    const rows = await this.db.graphNode.groupBy({ by: ["typeKey"], where: { connectionId, state: "active" }, _count: { _all: true } });
    return rows.map((r) => ({ typeKey: r.typeKey, count: r._count._all }));
  }

  async countEdgesByType(connectionId: string): Promise<TypeCount[]> {
    const rows = await this.db.graphEdge.groupBy({ by: ["typeKey"], where: { connectionId, state: "active" }, _count: { _all: true } });
    return rows.map((r) => ({ typeKey: r.typeKey, count: r._count._all }));
  }

  async latestCoverage(connectionId: string): Promise<GraphCoverage | null> {
    const scan = await this.db.scan.findFirst({
      where: { connectionId, status: { in: ["completed", "completed_with_errors"] }, results: { some: { category: { startsWith: "graph_" } } } },
      orderBy: { startedAt: "desc" },
      select: { id: true, finishedAt: true, results: { where: { category: { startsWith: "graph_" } }, orderBy: { category: "asc" }, select: { category: true, coverage: true, coverageDetail: true, itemCount: true } } },
    });
    if (!scan) return null;
    return {
      scanId: scan.id,
      finishedAt: scan.finishedAt,
      stages: scan.results.map((r) => ({ category: r.category, coverage: asCoverage(r.coverage), detail: r.coverageDetail, itemCount: r.itemCount })),
    };
  }
}
