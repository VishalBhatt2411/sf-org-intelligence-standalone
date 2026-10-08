import { nodeTypeKey } from "../../graph/nodeTypes";
import { SECTIONS } from "../config";
import type { SectionKey, SectionResult, Severity } from "../types";
import { DEPENDENCY_EDGES, kpi, plural, type SectionContext } from "./shared";

// Overview (unscored, scan-derived): what the last scan found, counted straight from the graph tables,
// plus a one-card summary of every other section built from their latest results.

export async function computeOverview(ctx: SectionContext): Promise<SectionResult> {
  const { graph, connectionId, now } = ctx;
  const [nodeCounts, edgeCounts, coverage] = await Promise.all([graph.countNodesByType(connectionId), graph.countEdgesByType(connectionId), graph.latestCoverage(connectionId)]);
  const nodes = new Map(nodeCounts.map((c) => [c.typeKey, c.count]));
  const nodeCount = (kind: Parameters<typeof nodeTypeKey>[0]) => nodes.get(nodeTypeKey(kind)) ?? 0;
  const edgeTotal = edgeCounts.reduce((a, c) => a + c.count, 0);
  const dependencyEdges = edgeCounts.filter((c) => DEPENDENCY_EDGES.includes(c.typeKey)).reduce((a, c) => a + c.count, 0);
  const total = nodeCounts.reduce((a, c) => a + c.count, 0);
  const lastScan = coverage?.finishedAt ?? null;

  const result: SectionResult = {
    section: "overview",
    label: "Overview",
    scored: false,
    score: null,
    severity: null,
    basis: "scan",
    computedAt: now.toISOString(),
    coverage:
      total === 0
        ? { complete: false, note: "No graph data yet — run a scan to populate it." }
        : { complete: coverage?.stages.every((s) => s.coverage === "complete") ?? false, note: lastScan ? `Last scan finished ${lastScan.toISOString()}` : "Last scan has not finished" },
    kpis: [],
    formula: null,
    breakdown: { title: "", caption: "", columns: [], rows: [] },
    heatmap: { columns: [], rows: [] },
    facts: [],
    unavailable: [],
  };
  if (total === 0) return result;

  result.kpis = [
    kpi("Objects", "Objects", nodeCount("CustomObject")),
    kpi("Fields", "Fields", nodeCount("CustomField")),
    kpi("ApexClasses", "Apex classes", nodeCount("ApexClass")),
    kpi("Triggers", "Triggers", nodeCount("ApexTrigger")),
    kpi("Flows", "Flows", nodeCount("Flow")),
    kpi("PermissionSets", "Permission sets", nodeCount("PermissionSet")),
    kpi("DependencyEdges", "Dependency edges", dependencyEdges),
    kpi("Edges", "All relationships", edgeTotal),
  ];
  if (coverage) {
    const partial = coverage.stages.filter((s) => s.coverage !== null && s.coverage !== "complete");
    if (partial.length > 0) result.facts.push({ label: "Graph coverage", value: `${plural(partial.length, "stage")} partial or degraded`, detail: partial.map((s) => s.category).join(", ") });
  }
  return result;
}

export type SummaryCard = {
  section: SectionKey;
  label: string;
  scored: boolean;
  live: boolean;
  score: number | null;
  severity: Severity | null;
  computedAt: string | null;
  complete: boolean;
  note: string;
  // The most severe thing in the section, in one sentence; null when nothing needs attention.
  topSignal: string | null;
};

// One card per section, in display order. A section nobody has computed yet shows as "not run".
export function buildSummary(results: Partial<Record<SectionKey, SectionResult>>): SummaryCard[] {
  return SECTIONS.map((info) => {
    const r = results[info.key];
    const top = r?.breakdown.rows[0];
    return {
      section: info.key,
      label: info.label,
      scored: info.scored,
      live: info.live,
      score: r?.score ?? null,
      severity: r?.severity ?? null,
      computedAt: r ? r.computedAt : null,
      complete: r ? r.coverage.complete : false,
      note: r ? r.coverage.note : info.live ? "Not run yet — run the check to read it from Salesforce." : info.blurb,
      topSignal: top && top.severity !== "good" ? `${top.label}: ${top.explanation}` : null,
    };
  });
}
