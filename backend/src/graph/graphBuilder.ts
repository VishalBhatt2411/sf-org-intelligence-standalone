import { edgeChecksum, nodeChecksum } from "./checksum";
import type { EdgeRow, GraphRepository, NodeRow, RetireResult, StoredRef } from "./graphRepository";
import { edgeKey, nodeKey } from "./keys";
import type { EdgeScope, ScannerOutput } from "./types";

// The only code that writes graph rows. One session covers one scan of one connection: stages are
// applied in order, each as a single transaction, and retiring is a separate step run once at the end
// so a type is only retired after a snapshot that was complete.

export type Counts = { created: number; updated: number; unchanged: number };
export type StageStats = {
  nodes: Counts;
  edges: Counts;
  // Edges not written because an endpoint was not emitted in this scan. Scanners filter these out
  // themselves, so a non-zero value means a scanner and the scope disagree; the stage is not a full
  // snapshot then and the caller must not retire on it.
  droppedEdges: number;
};

type Plan<R> = { create: R[]; update: R[]; touch: string[]; counts: Counts };

// Create what is new, rewrite what changed, and only stamp what is unchanged. Rows are compared by
// checksum, so a re-scan of an unchanged org writes no content at all.
function plan<R extends { checksum: string }>(rows: R[], keyOf: (row: R) => string, stored: StoredRef[]): Plan<R> {
  const byKey = new Map(stored.map((s) => [s.key, s]));
  const out: Plan<R> = { create: [], update: [], touch: [], counts: { created: 0, updated: 0, unchanged: 0 } };
  for (const row of rows) {
    const existing = byKey.get(keyOf(row));
    if (!existing) {
      out.create.push(row);
      out.counts.created++;
    } else if (existing.checksum !== row.checksum) {
      out.update.push(row);
      out.counts.updated++;
    } else {
      out.touch.push(keyOf(row));
      out.counts.unchanged++;
    }
  }
  return out;
}

export class GraphBuildSession {
  private readonly emitted = new Set<string>();

  constructor(
    private readonly repository: GraphRepository,
    readonly connectionId: string,
    readonly scanId: string
  ) {}

  // Node keys persisted by the stages applied so far.
  get emittedKeys(): ReadonlySet<string> {
    return this.emitted;
  }

  async applyStage(output: ScannerOutput): Promise<StageStats> {
    const nodes = new Map<string, NodeRow>();
    for (const draft of output.nodes) {
      const key = nodeKey(draft.typeKey, draft.namespace, draft.fqn);
      if (!nodes.has(key)) nodes.set(key, { ...draft, nodeKey: key, checksum: nodeChecksum(draft) });
    }

    const edges = new Map<string, EdgeRow>();
    let droppedEdges = 0;
    const known = (key: string) => nodes.has(key) || this.emitted.has(key);
    for (const draft of output.edges) {
      if (!known(draft.sourceNodeKey) || !known(draft.targetNodeKey)) {
        droppedEdges++;
        continue;
      }
      const key = edgeKey(draft.sourceNodeKey, draft.typeKey, draft.targetNodeKey);
      if (!edges.has(key)) edges.set(key, { ...draft, edgeKey: key, checksum: edgeChecksum(draft) });
    }

    const { connectionId, scanId } = this;
    const stats = await this.repository.transaction(async (repo) => {
      const nodePlan = plan([...nodes.values()], (r) => r.nodeKey, await repo.findNodes(connectionId, [...nodes.keys()]));
      await repo.createNodes(connectionId, scanId, nodePlan.create);
      await repo.updateNodes(connectionId, scanId, nodePlan.update);
      await repo.touchNodes(connectionId, scanId, nodePlan.touch);

      const edgePlan = plan([...edges.values()], (r) => r.edgeKey, await repo.findEdges(connectionId, [...edges.keys()]));
      await repo.createEdges(connectionId, scanId, edgePlan.create);
      await repo.updateEdges(connectionId, scanId, edgePlan.update);
      await repo.touchEdges(connectionId, scanId, edgePlan.touch);
      return { nodes: nodePlan.counts, edges: edgePlan.counts, droppedEdges };
    });

    // Only a stage that committed counts: a later stage must not link to nodes that were rolled back.
    for (const key of nodes.keys()) this.emitted.add(key);
    return stats;
  }

  // Call once, after every owning stage ran as a complete snapshot (see PortDesign "retire").
  retire(nodeTypeKeys: string[], edgeScopes: EdgeScope[]): Promise<RetireResult> {
    return this.repository.transaction((repo) => repo.retire(this.connectionId, this.scanId, nodeTypeKeys, edgeScopes));
  }
}
