import { Prisma, type PrismaClient } from "@prisma/client";
import type { EdgeDraft, EdgeScope, GraphState, NodeDraft } from "./types";

// All Prisma access to the graph tables. The builder and the read services depend on this interface,
// never on Prisma, so they are tested against the in-memory implementation and the storage can change
// without touching them.

export type NodeRow = NodeDraft & { nodeKey: string; checksum: string };
export type EdgeRow = EdgeDraft & { edgeKey: string; checksum: string };
// The part of a stored row the builder needs to decide between create, update and touch.
export type StoredRef = { key: string; checksum: string; state: GraphState };
export type RetireResult = { nodes: number; edges: number };

export interface GraphRepository {
  // Runs `work` atomically. The repository handed to it is bound to the transaction.
  transaction<T>(work: (repo: GraphRepository) => Promise<T>): Promise<T>;

  findNodes(connectionId: string, keys: string[]): Promise<StoredRef[]>;
  findEdges(connectionId: string, keys: string[]): Promise<StoredRef[]>;

  createNodes(connectionId: string, scanId: string, rows: NodeRow[]): Promise<void>;
  createEdges(connectionId: string, scanId: string, rows: EdgeRow[]): Promise<void>;
  // Rewrites content, marks the row active and stamps it as seen in this scan.
  updateNodes(connectionId: string, scanId: string, rows: NodeRow[]): Promise<void>;
  updateEdges(connectionId: string, scanId: string, rows: EdgeRow[]): Promise<void>;
  // Content unchanged: only stamps the row as seen (and active again, if it had been stale).
  touchNodes(connectionId: string, scanId: string, keys: string[]): Promise<void>;
  touchEdges(connectionId: string, scanId: string, keys: string[]): Promise<void>;

  // Marks stale every active node of the given types, and every active edge in the given scopes,
  // that this scan did not see; then every edge left touching a stale node.
  retire(connectionId: string, scanId: string, nodeTypeKeys: string[], edgeScopes: EdgeScope[]): Promise<RetireResult>;
}

// Postgres caps a statement at 32767 bind parameters; stay far below that.
const CHUNK = 1000;
const TRANSACTION_TIMEOUT_MS = 120_000;

export function chunked<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Db = PrismaClient | Prisma.TransactionClient;

const json = (value: Record<string, unknown>) => value as Prisma.InputJsonValue;
const asState = (value: string): GraphState => (value === "stale" ? "stale" : "active");

export class PrismaGraphRepository implements GraphRepository {
  constructor(private readonly db: Db) {}

  async transaction<T>(work: (repo: GraphRepository) => Promise<T>): Promise<T> {
    // Already inside a transaction: join it.
    if (!("$transaction" in this.db)) return work(this);
    return (this.db as PrismaClient).$transaction((tx) => work(new PrismaGraphRepository(tx)), { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 10_000 });
  }

  async findNodes(connectionId: string, keys: string[]): Promise<StoredRef[]> {
    const out: StoredRef[] = [];
    for (const part of chunked(keys)) {
      const rows = await this.db.graphNode.findMany({ where: { connectionId, nodeKey: { in: part } }, select: { nodeKey: true, checksum: true, state: true } });
      for (const r of rows) out.push({ key: r.nodeKey, checksum: r.checksum, state: asState(r.state) });
    }
    return out;
  }

  async findEdges(connectionId: string, keys: string[]): Promise<StoredRef[]> {
    const out: StoredRef[] = [];
    for (const part of chunked(keys)) {
      const rows = await this.db.graphEdge.findMany({ where: { connectionId, edgeKey: { in: part } }, select: { edgeKey: true, checksum: true, state: true } });
      for (const r of rows) out.push({ key: r.edgeKey, checksum: r.checksum, state: asState(r.state) });
    }
    return out;
  }

  async createNodes(connectionId: string, scanId: string, rows: NodeRow[]): Promise<void> {
    for (const part of chunked(rows)) {
      await this.db.graphNode.createMany({
        data: part.map((r) => ({
          connectionId,
          nodeKey: r.nodeKey,
          typeKey: r.typeKey,
          label: r.label,
          fqn: r.fqn,
          namespace: r.namespace,
          parentKey: r.parentKey,
          attributes: json(r.attributes),
          checksum: r.checksum,
          state: "active",
          firstSeenScanId: scanId,
          lastSeenScanId: scanId,
        })),
      });
    }
  }

  async createEdges(connectionId: string, scanId: string, rows: EdgeRow[]): Promise<void> {
    for (const part of chunked(rows)) {
      await this.db.graphEdge.createMany({
        data: part.map((r) => ({
          connectionId,
          edgeKey: r.edgeKey,
          typeKey: r.typeKey,
          sourceNodeKey: r.sourceNodeKey,
          targetNodeKey: r.targetNodeKey,
          confidence: r.confidence,
          attributes: json(r.attributes),
          checksum: r.checksum,
          state: "active",
          firstSeenScanId: scanId,
          lastSeenScanId: scanId,
        })),
      });
    }
  }

  async updateNodes(connectionId: string, scanId: string, rows: NodeRow[]): Promise<void> {
    for (const r of rows) {
      await this.db.graphNode.update({
        where: { connectionId_nodeKey: { connectionId, nodeKey: r.nodeKey } },
        data: { typeKey: r.typeKey, label: r.label, fqn: r.fqn, namespace: r.namespace, parentKey: r.parentKey, attributes: json(r.attributes), checksum: r.checksum, state: "active", lastSeenScanId: scanId },
      });
    }
  }

  async updateEdges(connectionId: string, scanId: string, rows: EdgeRow[]): Promise<void> {
    for (const r of rows) {
      await this.db.graphEdge.update({
        where: { connectionId_edgeKey: { connectionId, edgeKey: r.edgeKey } },
        data: { confidence: r.confidence, attributes: json(r.attributes), checksum: r.checksum, state: "active", lastSeenScanId: scanId },
      });
    }
  }

  async touchNodes(connectionId: string, scanId: string, keys: string[]): Promise<void> {
    for (const part of chunked(keys)) {
      await this.db.graphNode.updateMany({ where: { connectionId, nodeKey: { in: part } }, data: { state: "active", lastSeenScanId: scanId } });
    }
  }

  async touchEdges(connectionId: string, scanId: string, keys: string[]): Promise<void> {
    for (const part of chunked(keys)) {
      await this.db.graphEdge.updateMany({ where: { connectionId, edgeKey: { in: part } }, data: { state: "active", lastSeenScanId: scanId } });
    }
  }

  // Set-based SQL: retiring is a comparison against every row of a type, so it is one statement per
  // type rather than a round trip per row.
  async retire(connectionId: string, scanId: string, nodeTypeKeys: string[], edgeScopes: EdgeScope[]): Promise<RetireResult> {
    let nodes = 0;
    let edges = 0;
    if (nodeTypeKeys.length > 0) {
      nodes = await this.db.$executeRaw`
        UPDATE graph_nodes SET state = 'stale'
        WHERE connection_id = ${connectionId} AND state = 'active' AND last_seen_scan_id <> ${scanId}
          AND type_key = ANY(${nodeTypeKeys}::text[])`;
    }
    for (const scope of edgeScopes) {
      edges += await this.db.$executeRaw`
        UPDATE graph_edges e SET state = 'stale'
        WHERE e.connection_id = ${connectionId} AND e.state = 'active' AND e.last_seen_scan_id <> ${scanId}
          AND e.type_key = ${scope.typeKey}
          AND (${scope.sourceTypeKey}::text IS NULL OR EXISTS (
            SELECT 1 FROM graph_nodes n
            WHERE n.connection_id = e.connection_id AND n.node_key = e.source_node_key AND n.type_key = ${scope.sourceTypeKey}::text))`;
    }
    if (nodes > 0) {
      edges += await this.db.$executeRaw`
        UPDATE graph_edges e SET state = 'stale'
        WHERE e.connection_id = ${connectionId} AND e.state = 'active'
          AND EXISTS (
            SELECT 1 FROM graph_nodes n
            WHERE n.connection_id = e.connection_id AND n.state = 'stale'
              AND (n.node_key = e.source_node_key OR n.node_key = e.target_node_key))`;
    }
    return { nodes, edges };
  }
}
