import { GraphNotFoundError } from "./errors";
import { indexNodes, toEdgeDto, toNodeDto, type EdgeDto, type NodeDto } from "./graphDto";
import type { GraphCoverage, GraphReadRepository, StoredEdge } from "./graphReadRepository";
import { kindOfTypeKey } from "./keys";
import { edgeKindInfo, nodeKindInfo } from "./nodeTypes";
import type { Confidence, Coverage } from "./types";

// Most edges counted for one node, and most listed. A node with more is reported as capped.
export const DETAIL_EDGE_CAP = 5000;
export const DETAIL_EDGE_LIST = 100;

export type EdgeSummaryRow = {
  typeKey: string;
  kind: string;
  direction: "out" | "in";
  // The role label read from this node's side: "References", "Referenced By", ...
  role: string;
  count: number;
  confidence: Record<Confidence, number>;
};

export type RelatedEdge = EdgeDto & { direction: "out" | "in"; other: Pick<NodeDto, "nodeKey" | "typeKey" | "kindLabel" | "label" | "fqn"> };

export type NodeDetail = {
  node: NodeDto;
  parent: NodeDto | null;
  edgeSummary: EdgeSummaryRow[];
  edges: RelatedEdge[];
  // The edge list is only the first DETAIL_EDGE_LIST; this is the total counted (up to DETAIL_EDGE_CAP).
  edgeTotal: number;
  capped: boolean;
};

export type GraphSummary = {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Array<{ typeKey: string; kind: string; kindLabel: string; count: number }>;
  edgesByType: Array<{ typeKey: string; kind: string; count: number }>;
  // "none" when no scan has built a graph yet; otherwise the weakest stage of the last graph scan.
  coverage: Coverage | "none";
  lastScan: { scanId: string; finishedAt: string | null } | null;
  stages: GraphCoverage["stages"];
};

const WEAKNESS: Record<Coverage, number> = { complete: 0, partial: 1, degraded: 2 };

function weakest(coverage: GraphCoverage | null): Coverage | "none" {
  if (!coverage) return "none";
  return coverage.stages.reduce<Coverage>((worst, s) => (s.coverage && WEAKNESS[s.coverage] > WEAKNESS[worst] ? s.coverage : worst), "complete");
}

export class DetailService {
  constructor(private readonly repo: GraphReadRepository) {}

  async nodeDetail(connectionId: string, nodeKey: string): Promise<NodeDetail> {
    const [node] = await this.repo.getNodes(connectionId, [nodeKey]);
    if (!node) throw new GraphNotFoundError("Node not found");

    const all = await this.repo.edgesOf(connectionId, [nodeKey], { direction: "both", limit: DETAIL_EDGE_CAP });
    const listed = all.slice(0, DETAIL_EDGE_LIST);
    const endpoints = new Set<string>([nodeKey]);
    if (node.parentKey) endpoints.add(node.parentKey);
    for (const e of listed) {
      endpoints.add(e.sourceNodeKey);
      endpoints.add(e.targetNodeKey);
    }
    const lookup = indexNodes(await this.repo.getNodes(connectionId, [...endpoints]));

    const related: RelatedEdge[] = [];
    for (const e of listed) {
      const direction = e.sourceNodeKey === nodeKey ? "out" : "in";
      const other = lookup.get(direction === "out" ? e.targetNodeKey : e.sourceNodeKey);
      if (!other) continue;
      const { nodeKey: key, typeKey, kindLabel, label, fqn } = toNodeDto(other);
      related.push({ ...toEdgeDto(e, lookup), direction, other: { nodeKey: key, typeKey, kindLabel, label, fqn } });
    }

    return {
      node: toNodeDto(node),
      parent: node.parentKey && lookup.get(node.parentKey) ? toNodeDto(lookup.get(node.parentKey)!) : null,
      edgeSummary: this.summarise(nodeKey, all),
      edges: related,
      edgeTotal: all.length,
      capped: all.length >= DETAIL_EDGE_CAP,
    };
  }

  private summarise(nodeKey: string, edges: StoredEdge[]): EdgeSummaryRow[] {
    const rows = new Map<string, EdgeSummaryRow>();
    for (const e of edges) {
      const direction = e.sourceNodeKey === nodeKey ? "out" : "in";
      const id = `${e.typeKey}|${direction}`;
      let row = rows.get(id);
      if (!row) {
        const info = edgeKindInfo(e.typeKey);
        row = { typeKey: e.typeKey, kind: info?.kind ?? kindOfTypeKey(e.typeKey), direction, role: (direction === "out" ? info?.sourceRole : info?.targetRole) ?? "Related To", count: 0, confidence: { exact: 0, parsed: 0, heuristic: 0 } };
        rows.set(id, row);
      }
      row.count++;
      row.confidence[e.confidence]++;
    }
    return [...rows.values()].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind) || a.direction.localeCompare(b.direction));
  }

  async summary(connectionId: string): Promise<GraphSummary> {
    const [nodeCounts, edgeCounts, coverage] = await Promise.all([this.repo.countNodesByType(connectionId), this.repo.countEdgesByType(connectionId), this.repo.latestCoverage(connectionId)]);
    return {
      totalNodes: nodeCounts.reduce((sum, r) => sum + r.count, 0),
      totalEdges: edgeCounts.reduce((sum, r) => sum + r.count, 0),
      nodesByType: nodeCounts
        .map((r) => {
          const info = nodeKindInfo(r.typeKey);
          return { typeKey: r.typeKey, kind: info?.kind ?? kindOfTypeKey(r.typeKey), kindLabel: info?.label ?? kindOfTypeKey(r.typeKey), count: r.count };
        })
        .sort((a, b) => b.count - a.count || a.kindLabel.localeCompare(b.kindLabel)),
      edgesByType: edgeCounts
        .map((r) => ({ typeKey: r.typeKey, kind: edgeKindInfo(r.typeKey)?.kind ?? kindOfTypeKey(r.typeKey), count: r.count }))
        .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
      coverage: weakest(coverage),
      lastScan: coverage ? { scanId: coverage.scanId, finishedAt: coverage.finishedAt ? coverage.finishedAt.toISOString() : null } : null,
      stages: coverage?.stages ?? [],
    };
  }
}
