import { nodeTypeKey } from "../../graph/nodeTypes";
import type { StoredNode } from "../../graph/graphReadRepository";
import { API_VERSION_MARGIN, CYCLE_SIGNAL_WEIGHT, PRIMARY_SIGNAL_WEIGHT } from "../config";
import { nodesInCycles } from "../cycles";
import { scoreSignals, severityOf, weightedShareScore } from "../scoring";
import { worstOf, type BreakdownRow, type FindingCandidate, type ScoreResult, type SectionComputation, type Severity } from "../types";
import { DEPENDENCY_EDGES, coverageNote, heatmapRows, kpi, noGraphData, plural, topCaption, worstRowFirst, type SectionContext } from "./shared";

// Code health: Apex classes that depend on a lot, sit in dependency cycles, or are on an old API version.
// The API version comes from the scan; a class scanned before versions were captured has none and is
// left out of that rule rather than guessed at.

type Row = {
  node: StoredNode;
  apiVersion: number | null;
  fanOut: number;
  fanIn: number;
  inCycle: boolean;
  dependency: { breached: boolean; score: ScoreResult };
  api: { breached: boolean; score: ScoreResult | null };
  cycle: { breached: boolean; score: ScoreResult };
  severity: Severity;
};

const versionOf = (node: StoredNode): number | null => (typeof node.attributes.apiVersion === "number" && Number.isFinite(node.attributes.apiVersion) ? node.attributes.apiVersion : null);

async function evaluate(ctx: SectionContext) {
  const { graph, connectionId, config } = ctx;
  const c = config.code;
  const nodes = await graph.browseNodes(connectionId, nodeTypeKey("ApexClass"), config.ceiling);
  const keys = nodes.map((n) => n.nodeKey);
  const [neighbours, pairs] = await Promise.all([graph.neighbourCounts(connectionId, keys, DEPENDENCY_EDGES), graph.edgesAmong(connectionId, keys, DEPENDENCY_EDGES)]);
  const cyclic = nodesInCycles(keys, pairs);

  const rows = nodes.map((node): Row => {
    const n = neighbours.get(node.nodeKey) ?? { out: 0, in: 0 };
    const combined = n.out + n.in;
    const apiVersion = versionOf(node);
    const inCycle = cyclic.has(node.nodeKey);

    const depScore = scoreSignals([
      { key: "HighDependency", label: "Combined fan-in/fan-out", weight: PRIMARY_SIGNAL_WEIGHT, magnitude: combined / c.dependencyThreshold, confidence: 0.8, note: `${combined} combined fan-in/fan-out vs. threshold ${c.dependencyThreshold}` },
    ]);
    const cycleScore = scoreSignals([
      { key: "DependencyCycle", label: "Dependency cycle membership", weight: CYCLE_SIGNAL_WEIGHT, magnitude: inCycle ? 1.5 : 0, confidence: 1, impactMultiplier: 0.8, note: inCycle ? "Part of a dependency cycle" : "" },
    ]);
    const apiScore =
      apiVersion !== null && apiVersion < c.apiVersionThreshold
        ? scoreSignals([
            { key: "OldApiVersion", label: "Old API version", weight: PRIMARY_SIGNAL_WEIGHT, magnitude: (c.apiVersionThreshold - apiVersion) / API_VERSION_MARGIN, confidence: 0.75, note: `API version ${apiVersion} vs. ${c.apiVersionThreshold}` },
          ])
        : null;

    const dependency = { breached: combined >= c.dependencyThreshold && depScore.severity !== "good", score: depScore };
    const cycle = { breached: inCycle && cycleScore.severity !== "good", score: cycleScore };
    const api = { breached: apiScore !== null && apiScore.severity !== "good", score: apiScore };
    const severity = worstOf(dependency.breached ? depScore.severity : "good", cycle.breached ? cycleScore.severity : "good", api.breached ? apiScore!.severity : "good");
    return { node, apiVersion, fanOut: n.out, fanIn: n.in, inCycle, dependency, api, cycle, severity };
  });
  return { rows, ceilingReached: nodes.length >= config.ceiling };
}

function explain(r: Row, ctx: SectionContext): string {
  const c = ctx.config.code;
  const parts: string[] = [];
  if (r.dependency.breached) parts.push(`${r.fanOut + r.fanIn} combined fan-in/fan-out (fan-out ${r.fanOut}, fan-in ${r.fanIn}) — at or above this org's threshold of ${c.dependencyThreshold}.`);
  if (r.api.breached) parts.push(`API version ${r.apiVersion} — noticeably older than the org's reference version ${c.apiVersionThreshold}.`);
  if (r.cycle.breached) parts.push("Takes part in a dependency cycle — it depends, directly or indirectly, on itself.");
  return parts.length > 0 ? parts.join(" ") : "No thresholds breached — dependencies and API version are within this org's configured ranges.";
}

const toRow = (r: Row, ctx: SectionContext): BreakdownRow => ({
  key: r.node.nodeKey,
  label: r.node.label,
  componentType: "Apex Class",
  severity: r.severity,
  metrics: [
    { column: "Fan-out", value: String(r.fanOut) },
    { column: "Fan-in", value: String(r.fanIn) },
    { column: "API", value: r.apiVersion === null ? "—" : String(r.apiVersion) },
    { column: "Cycle", value: r.inCycle ? "Y" : "N" },
  ],
  explanation: explain(r, ctx),
});

export async function computeCode(ctx: SectionContext): Promise<SectionComputation> {
  const { config, now } = ctx;
  const c = config.code;
  const { rows, ceilingReached } = await evaluate(ctx);
  if (rows.length === 0) return { result: noGraphData("code", "Code", true, now, "Apex classes"), candidates: [] };

  const total = rows.length;
  const highDep = rows.filter((r) => r.dependency.breached).length;
  const oldApi = rows.filter((r) => r.api.breached).length;
  const cycles = rows.filter((r) => r.cycle.breached).length;
  const unversioned = rows.filter((r) => r.apiVersion === null).length;
  const score = weightedShareScore(total, [
    { count: highDep, weight: c.dependencyWeight },
    { count: oldApi, weight: c.apiVersionWeight },
  ]);

  const attention = rows.filter((r) => r.severity !== "good").sort((a, b) => worstRowFirst(a, b) || b.fanOut + b.fanIn - (a.fanOut + a.fanIn) || a.node.label.localeCompare(b.node.label));
  const shown = attention.slice(0, 8).map((r) => toRow(r, ctx));
  const coverage = coverageNote(total, "Apex classes", ceilingReached);
  if (unversioned > 0) {
    coverage.complete = false;
    coverage.note += `; ${plural(unversioned, "class", "classes")} had no API version recorded — run a new scan to capture it`;
  }

  return {
    result: {
      section: "code",
      label: "Code",
      scored: true,
      score,
      severity: score === null ? null : severityOf(score),
      basis: "scan",
      computedAt: now.toISOString(),
      coverage,
      kpis: [
        kpi("HighDependency", "High-dependency classes", highDep, "HighDependency"),
        kpi("OldApiVersion", "Classes on an old API version", oldApi, "OldApiVersion"),
        kpi("Cycles", "Classes in dependency cycles", cycles, "Cycles"),
      ],
      formula: {
        summary: "100 minus a weighted penalty for each rule below that a class breaches. Dependency cycles are reported but not scored.",
        components: [
          { label: `High dependency — classes with ≥ ${c.dependencyThreshold} combined fan-in/fan-out`, weight: `${c.dependencyWeight}%` },
          { label: `Old API version — classes noticeably below API version ${c.apiVersionThreshold}`, weight: `${c.apiVersionWeight}%` },
        ],
      },
      breakdown: { title: "Classes needing attention", caption: topCaption(shown.length, attention.length), columns: ["Fan-out", "Fan-in", "API"], rows: shown },
      heatmap: { columns: ["Fan-out", "Fan-in", "API", "Cycle"], rows: heatmapRows(attention.map((r) => toRow(r, ctx)), ["Fan-out", "Fan-in", "API", "Cycle"], 5) },
      facts: [],
      unavailable: [],
    },
    candidates: rows.flatMap((r) => candidatesFor(r, ctx)),
  };
}

export async function codeDrilldown(ctx: SectionContext, metricKey: string) {
  const { rows } = await evaluate(ctx);
  const pick: Record<string, [string, (r: Row) => boolean]> = {
    HighDependency: ["High-dependency classes", (r) => r.dependency.breached],
    OldApiVersion: ["Classes on an old API version", (r) => r.api.breached],
    Cycles: ["Classes in dependency cycles", (r) => r.cycle.breached],
  };
  const [title, keep] = pick[metricKey] ?? ["Classes ranked by dependencies", () => true];
  const picked = rows.filter(keep).sort((a, b) => b.fanOut + b.fanIn - (a.fanOut + a.fanIn) || a.node.label.localeCompare(b.node.label));
  return { title, caption: plural(picked.length, "class", "classes"), columns: ["Fan-out", "Fan-in", "API", "Cycle"], rows: picked.slice(0, 500).map((r) => toRow(r, ctx)) };
}

function candidatesFor(r: Row, ctx: SectionContext): FindingCandidate[] {
  const c = ctx.config.code;
  const label = r.node.label;
  const base = { section: "code" as const, ruleVersion: 1, componentKey: r.node.nodeKey, componentType: "Apex Class", componentLabel: label };
  const out: FindingCandidate[] = [];
  if (r.dependency.breached) {
    const combined = r.fanOut + r.fanIn;
    out.push({
      ...base,
      ruleKey: "CodeHealth.HighDependency",
      title: `${label} has an unusually high combined fan-in/fan-out`,
      severity: r.dependency.score.severity,
      confidence: "medium",
      score: r.dependency.score.badness,
      evidence: `${plural(combined, "combined fan-in/fan-out edge")} detected (fan-out ${r.fanOut}, fan-in ${r.fanIn}; configured threshold: ${c.dependencyThreshold}). ${r.dependency.score.explanation}`,
      measured: `${combined} combined fan-in/fan-out`,
      expected: `< ${c.dependencyThreshold} combined fan-in/fan-out`,
      explanation: `${label} uses ${r.fanOut} components and is used by ${r.fanIn}, at or above this org's threshold of ${c.dependencyThreshold}. ${r.dependency.score.explanation}`,
      risk: "A class wired to many others is hard to change safely and hard to test in isolation.",
      impact: "Changes to this class can break its callers, and it is affected by changes to everything it uses.",
      remediation: "Split the class by responsibility, and depend on narrow interfaces instead of many concrete classes.",
      validation: `Re-run the scan after the refactor; the combined fan-in/fan-out should fall below ${c.dependencyThreshold}.`,
      contributors: r.dependency.score.contributors,
    });
  }
  if (r.api.breached && r.api.score) {
    out.push({
      ...base,
      ruleKey: "CodeHealth.OldApiVersion",
      title: `${label} is on an old API version`,
      severity: r.api.score.severity,
      confidence: "medium",
      score: r.api.score.badness,
      evidence: `${label} is saved at API version ${r.apiVersion} (reference version: ${c.apiVersionThreshold}). ${r.api.score.explanation}`,
      measured: `API version ${r.apiVersion}`,
      expected: `API version ${c.apiVersionThreshold} or later`,
      explanation: `${label} has not been saved against a recent Salesforce release, so it runs with older platform behaviour.`,
      risk: "Old API versions miss platform fixes and may rely on behaviour Salesforce has since retired.",
      impact: "Retired API versions stop working; upgrading later is harder the further behind the class is.",
      remediation: "Raise the API version, run the class's tests, and deploy. Review the release notes for behaviour changes first.",
      validation: `Re-run the scan; the class should show API version ${c.apiVersionThreshold} or later.`,
      contributors: r.api.score.contributors,
    });
  }
  if (r.cycle.breached) {
    out.push({
      ...base,
      ruleKey: "CodeHealth.DependencyCycle",
      title: `${label} participates in a dependency cycle`,
      severity: r.cycle.score.severity,
      confidence: "medium",
      score: r.cycle.score.badness,
      evidence: `${label} is part of a loop of classes that depend on each other. ${r.cycle.score.explanation}`,
      measured: "In a dependency cycle",
      expected: "Not applicable — informational, for review only",
      explanation: `${label} depends, directly or through other classes, on itself.`,
      risk: "Cyclic dependencies make classes hard to test and change independently.",
      impact: "A change to any class in the loop can ripple through all of them.",
      remediation: "Extract the shared logic into a class both sides depend on, or invert one dependency. If the cycle is intentional, mark this finding Risk Accepted.",
      validation: "Re-run the scan; the class should no longer appear in a cycle.",
      contributors: r.cycle.score.contributors,
    });
  }
  return out;
}
