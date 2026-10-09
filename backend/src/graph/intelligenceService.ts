import { GraphNotFoundError } from "./errors";
import { indexNodes, toNodeDto } from "./graphDto";
import type { GraphReadRepository, StageCoverage, StoredNode } from "./graphReadRepository";
import { edgeKindInfo, nodeKindInfo, type NodeCategory } from "./nodeTypes";

// Per-node "what automation, code and security touches this component" (port of the native
// OI_NodeIntelligenceService). It only groups the neighbours the graph already holds by their node
// category, so it adds no scan work; the honest part is saying WHY a list is empty.

export const INTELLIGENCE_EDGE_CAP = 5000;
export const INTELLIGENCE_ITEM_CAP = 200;
export const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export type IntelligenceCategoryKey = Extract<NodeCategory, "automation" | "code" | "security">;

const CATEGORIES: ReadonlyArray<{ key: IntelligenceCategoryKey; label: string; stages: readonly string[] }> = [
  { key: "automation", label: "Automation", stages: ["triggers", "flows", "validation_rules", "workflow_rules", "email_alerts", "approval_processes"] },
  { key: "code", label: "Code", stages: ["apex_classes", "triggers", "dependencies"] },
  { key: "security", label: "Security", stages: ["permission_sets", "sharing_rules"] },
];

export type IntelligenceStatus = "active" | "inactive" | "draft" | "obsolete";
export type EmptyState = "unscanned" | "incomplete" | "stale" | "none";

export type IntelligenceItem = {
  nodeKey: string;
  label: string;
  typeKey: string;
  kindLabel: string;
  // "in": the item uses this component. "out": this component uses the item.
  direction: "in" | "out";
  edgeTypeKey: string;
  status: IntelligenceStatus | null;
};

export type IntelligenceCategory = {
  category: IntelligenceCategoryKey;
  label: string;
  items: IntelligenceItem[];
  total: number;
  truncated: boolean;
  // Why an empty list is empty; "none" is a genuine zero.
  emptyState: EmptyState;
  coverageNote: string | null;
};

export type NodeIntelligence = {
  nodeKey: string;
  lastScannedAt: string | null;
  // True when any scanned section was not complete: dependency types the panel may be missing.
  hasCoverageLimitations: boolean;
  categories: IntelligenceCategory[];
};

const text = (value: unknown): string => (typeof value === "string" ? value.toLowerCase() : "");

// Flows say Active/Draft/Obsolete/InvalidDraft, approval processes Active/Inactive, rules a boolean.
export function statusOf(node: StoredNode): IntelligenceStatus | null {
  const a = node.attributes;
  if (typeof a.active === "boolean") return a.active ? "active" : "inactive";
  const raw = text(a.status) || text(a.state);
  if (!raw) return null;
  if (raw === "active") return "active";
  if (raw === "obsolete") return "obsolete";
  if (raw === "draft" || raw === "invaliddraft") return "draft";
  if (raw === "inactive") return "inactive";
  return null;
}

function relevantStages(stages: StageCoverage[], names: readonly string[]): StageCoverage[] {
  const wanted = new Set(names.map((n) => `graph_${n}`));
  return stages.filter((s) => wanted.has(s.category));
}

export class IntelligenceService {
  constructor(
    private readonly repo: GraphReadRepository,
    private readonly now: () => number = Date.now
  ) {}

  async forNode(connectionId: string, nodeKey: string): Promise<NodeIntelligence> {
    const [node] = await this.repo.getNodes(connectionId, [nodeKey]);
    if (!node) throw new GraphNotFoundError("Node not found");
    const [edges, coverage] = await Promise.all([this.repo.edgesOf(connectionId, [nodeKey], { direction: "both", limit: INTELLIGENCE_EDGE_CAP }), this.repo.latestCoverage(connectionId)]);
    const edgesCapped = edges.length >= INTELLIGENCE_EDGE_CAP;

    const otherKeys = new Set<string>();
    for (const e of edges) otherKeys.add(e.sourceNodeKey === nodeKey ? e.targetNodeKey : e.sourceNodeKey);
    otherKeys.delete(nodeKey);
    const others = indexNodes(await this.repo.getNodes(connectionId, [...otherKeys]));

    const buckets = new Map<IntelligenceCategoryKey, IntelligenceItem[]>(CATEGORIES.map((c) => [c.key, []]));
    const seen = new Set<string>();
    for (const e of edges) {
      const direction = e.sourceNodeKey === nodeKey ? "out" : "in";
      const other = others.get(direction === "out" ? e.targetNodeKey : e.sourceNodeKey);
      if (!other || edgeKindInfo(e.typeKey)?.kind === "HAS_FIELD") continue;
      const dto = toNodeDto(other);
      for (const category of dto.categories) {
        const bucket = buckets.get(category as IntelligenceCategoryKey);
        const id = `${category}|${other.nodeKey}|${direction}|${e.typeKey}`;
        if (!bucket || seen.has(id)) continue;
        seen.add(id);
        bucket.push({ nodeKey: other.nodeKey, label: other.label, typeKey: other.typeKey, kindLabel: nodeKindInfo(other.typeKey)?.label ?? dto.kindLabel, direction, edgeTypeKey: e.typeKey, status: statusOf(other) });
      }
    }

    const finishedAt = coverage?.finishedAt ?? null;
    const stale = finishedAt ? this.now() - finishedAt.getTime() > STALE_AFTER_MS : false;
    const stages = coverage?.stages ?? [];
    const hasCoverageLimitations = stages.some((s) => s.coverage !== null && s.coverage !== "complete");

    const categories = CATEGORIES.map<IntelligenceCategory>((def) => {
      const all = (buckets.get(def.key) ?? []).sort((a, b) => a.kindLabel.localeCompare(b.kindLabel) || a.label.localeCompare(b.label));
      const gaps = relevantStages(stages, def.stages).filter((s) => s.coverage !== null && s.coverage !== "complete");
      const truncated = edgesCapped || all.length > INTELLIGENCE_ITEM_CAP;
      let emptyState: EmptyState = "none";
      if (!coverage) emptyState = "unscanned";
      else if (truncated || gaps.length > 0) emptyState = "incomplete";
      else if (stale) emptyState = "stale";
      return {
        category: def.key,
        label: def.label,
        items: all.slice(0, INTELLIGENCE_ITEM_CAP),
        total: all.length,
        truncated,
        emptyState,
        coverageNote: gaps.length > 0 ? gaps.map((s) => `${s.category.replace(/^graph_/, "").replace(/_/g, " ")}: ${s.coverage}${s.detail ? ` (${s.detail})` : ""}`).join("; ") : null,
      };
    });

    return { nodeKey, lastScannedAt: finishedAt ? finishedAt.toISOString() : null, hasCoverageLimitations, categories };
  }
}
