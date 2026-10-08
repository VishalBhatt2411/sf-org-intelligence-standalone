import { edgeTypeKey, nodeTypeKey } from "../../graph/nodeTypes";
import type { StoredNode } from "../../graph/graphReadRepository";
import { CYCLE_SIGNAL_WEIGHT, PRIMARY_SIGNAL_WEIGHT } from "../config";
import { nodesInCycles } from "../cycles";
import { scoreSignals } from "../scoring";
import { worstOf, type BreakdownRow, type FindingCandidate, type ScoreResult, type SectionComputation, type Severity } from "../types";
import { DEPENDENCY_EDGES, coverageNote, heatmapRows, kpi, noGraphData, plural, topCaption, worstRowFirst, type SectionContext } from "./shared";

// Automation health (facts only, unscored): which triggers and flows depend on a lot, or on each other.
// Fan-out / fan-in count the distinct components a trigger or flow points at / is pointed at by, through
// REFERENCES and DEPENDS_ON edges.

type Row = {
  node: StoredNode;
  type: "Apex Trigger" | "Flow";
  fanOut: number;
  fanIn: number;
  inCycle: boolean;
  high: { breached: boolean; score: ScoreResult };
  cycle: { breached: boolean; score: ScoreResult };
  severity: Severity;
};

async function evaluate(ctx: SectionContext) {
  const { graph, connectionId, config } = ctx;
  const threshold = config.automation.dependencyThreshold;
  const [triggers, flows] = await Promise.all([
    graph.browseNodes(connectionId, nodeTypeKey("ApexTrigger"), config.ceiling),
    graph.browseNodes(connectionId, nodeTypeKey("Flow"), config.ceiling),
  ]);
  const all = [...triggers.map((node) => ({ node, type: "Apex Trigger" as const })), ...flows.map((node) => ({ node, type: "Flow" as const }))];
  const keys = all.map((c) => c.node.nodeKey);
  const [neighbours, pairs, targets] = await Promise.all([
    graph.neighbourCounts(connectionId, keys, DEPENDENCY_EDGES),
    graph.edgesAmong(connectionId, keys, DEPENDENCY_EDGES),
    graph.executionTargets(connectionId, keys, edgeTypeKey("EXECUTES_ON")),
  ]);
  const cyclic = nodesInCycles(keys, pairs);

  const rows = all.map(({ node, type }): Row => {
    const n = neighbours.get(node.nodeKey) ?? { out: 0, in: 0 };
    const combined = n.out + n.in;
    const inCycle = cyclic.has(node.nodeKey);
    const highScore = scoreSignals([
      { key: "HighDependency", label: "Combined fan-in/fan-out", weight: PRIMARY_SIGNAL_WEIGHT, magnitude: combined / threshold, confidence: 0.8, note: `${combined} combined fan-in/fan-out vs. threshold ${threshold}` },
    ]);
    const cycleScore = scoreSignals([
      { key: "DependencyCycle", label: "Dependency cycle membership", weight: CYCLE_SIGNAL_WEIGHT, magnitude: inCycle ? 1.5 : 0, confidence: 1, impactMultiplier: 0.8, note: inCycle ? "Part of a dependency cycle" : "" },
    ]);
    const high = { breached: combined >= threshold && highScore.severity !== "good", score: highScore };
    const cycle = { breached: inCycle && cycleScore.severity !== "good", score: cycleScore };
    return { node, type, fanOut: n.out, fanIn: n.in, inCycle, high, cycle, severity: worstOf(high.breached ? highScore.severity : "good", cycle.breached ? cycleScore.severity : "good") };
  });
  return { rows, triggers: triggers.length, flows: flows.length, targets, ceilingReached: triggers.length >= config.ceiling || flows.length >= config.ceiling };
}

const toRow = (r: Row): BreakdownRow => ({
  key: r.node.nodeKey,
  label: r.node.label,
  componentType: r.type,
  severity: r.severity,
  metrics: [
    { column: "Fan-out", value: String(r.fanOut) },
    { column: "Fan-in", value: String(r.fanIn) },
    { column: "Cycle", value: r.inCycle ? "Y" : "N" },
  ],
  explanation: explain(r),
});

function explain(r: Row): string {
  const parts: string[] = [];
  if (r.high.breached) parts.push(`${r.fanOut + r.fanIn} combined fan-in/fan-out (fan-out ${r.fanOut}, fan-in ${r.fanIn}) — at or above this org's threshold.`);
  if (r.cycle.breached) parts.push("Takes part in a dependency cycle — it depends, directly or indirectly, on itself.");
  return parts.length > 0 ? parts.join(" ") : "No thresholds breached — dependencies are within this org's configured range.";
}

export async function computeAutomation(ctx: SectionContext): Promise<SectionComputation> {
  const { config, now, graph, connectionId } = ctx;
  const { rows, triggers, flows, targets, ceilingReached } = await evaluate(ctx);
  if (rows.length === 0) return { result: noGraphData("automation", "Automation", false, now, "triggers or flows"), candidates: [] };

  const attention = rows
    .filter((r) => r.severity !== "good")
    .sort((a, b) => Number(b.cycle.breached) - Number(a.cycle.breached) || worstRowFirst(a, b) || b.fanOut + b.fanIn - (a.fanOut + a.fanIn) || a.node.label.localeCompare(b.node.label));
  const shown = attention.slice(0, 8).map(toRow);

  const [topKey, topCount] = [...targets].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [null, 0];
  const topObject = topKey ? (await graph.getNodes(connectionId, [topKey]))[0] : undefined;

  const scanned = triggers + flows;
  return {
    result: {
      section: "automation",
      label: "Automation",
      scored: false,
      score: null,
      severity: null,
      basis: "scan",
      computedAt: now.toISOString(),
      coverage: coverageNote(scanned, "automation components", ceilingReached),
      kpis: [
        kpi("Triggers", "Triggers scanned", triggers),
        kpi("Flows", "Flows scanned", flows),
        kpi("HighDependency", "High fan-in/out components", rows.filter((r) => r.high.breached).length, "HighDependency"),
        kpi("Cycles", "Components in dependency cycles", rows.filter((r) => r.cycle.breached).length, "Cycles"),
        kpi("MostAutomatedObject", "Most automated object", topObject ? `${topObject.label} (${topCount})` : "None detected"),
      ],
      formula: null,
      breakdown: { title: "Components needing attention", caption: topCaption(shown.length, attention.length), columns: ["Fan-out", "Fan-in"], rows: shown },
      heatmap: { columns: ["Fan-out", "Fan-in", "Cycle"], rows: heatmapRows(attention.map(toRow), ["Fan-out", "Fan-in", "Cycle"], 5) },
      facts: [],
      unavailable: [],
    },
    candidates: rows.flatMap((r) => candidatesFor(r, config.automation.dependencyThreshold)),
  };
}

export async function automationDrilldown(ctx: SectionContext, metricKey: string) {
  const { rows } = await evaluate(ctx);
  const picked = rows.filter((r) => (metricKey === "Cycles" ? r.cycle.breached : r.high.breached)).sort((a, b) => b.fanOut + b.fanIn - (a.fanOut + a.fanIn) || a.node.label.localeCompare(b.node.label));
  return {
    title: metricKey === "Cycles" ? "Components in dependency cycles" : "High fan-in/out components",
    caption: plural(picked.length, "component"),
    columns: ["Fan-out", "Fan-in", "Cycle"],
    rows: picked.map(toRow),
  };
}

function candidatesFor(r: Row, threshold: number): FindingCandidate[] {
  const label = r.node.label;
  const base = { section: "automation" as const, ruleVersion: 1, componentKey: r.node.nodeKey, componentType: r.type, componentLabel: label };
  const out: FindingCandidate[] = [];
  if (r.high.breached) {
    const combined = r.fanOut + r.fanIn;
    out.push({
      ...base,
      ruleKey: "AutomationHealth.HighDependency",
      title: `${label} has an unusually high combined fan-in/fan-out`,
      severity: r.high.score.severity,
      confidence: "medium",
      score: r.high.score.badness,
      evidence: `${plural(combined, "combined fan-in/fan-out REFERENCES edge")} detected (fan-out ${r.fanOut}, fan-in ${r.fanIn}; configured threshold: ${threshold}). ${r.high.score.explanation}`,
      measured: `${combined} combined fan-in/fan-out`,
      expected: `< ${threshold} combined fan-in/fan-out`,
      explanation: `${label} depends on ${r.fanOut} components and is depended on by ${r.fanIn}, at or above this org's threshold of ${threshold}. ${r.high.score.explanation}`,
      risk: "A component wired to many others is hard to change safely and is a likely source of unexpected side effects.",
      impact: "Edits to this trigger or flow can break the components that depend on it, and its behaviour depends on every component it calls.",
      remediation: "Split responsibilities so each trigger or flow does one job, and move shared logic into a single helper rather than many direct references.",
      validation: `Re-run the scan after the refactor; the combined fan-in/fan-out should fall below ${threshold}.`,
      contributors: r.high.score.contributors,
    });
  }
  if (r.cycle.breached) {
    out.push({
      ...base,
      ruleKey: "AutomationHealth.DependencyCycle",
      title: `${label} participates in a dependency cycle`,
      severity: r.cycle.score.severity,
      confidence: "medium",
      score: r.cycle.score.badness,
      evidence: `${label} is part of a loop of automation components that depend on each other. ${r.cycle.score.explanation}`,
      measured: "In a dependency cycle",
      expected: "Not applicable — informational, for review only",
      explanation: `${label} depends, directly or through other components, on itself. Some cycles are intentional (for example recursion guarded by a static flag).`,
      risk: "Cycles can cause recursion, repeated execution and governor-limit failures.",
      impact: "A change anywhere in the loop can re-trigger the rest of it.",
      remediation: "Check that the cycle is guarded against re-entry. If it is intentional, mark this finding Risk Accepted; otherwise break the loop.",
      validation: "Re-run the scan; the component should no longer appear in a cycle.",
      contributors: r.cycle.score.contributors,
    });
  }
  return out;
}
