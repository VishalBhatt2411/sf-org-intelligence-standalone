import { edgeTypeKey, nodeTypeKey } from "../../graph/nodeTypes";
import type { StoredNode } from "../../graph/graphReadRepository";
import { NO_REFERENCES_SIGNAL_WEIGHT, PRIMARY_SIGNAL_WEIGHT } from "../config";
import { scoreSignals, severityOf, weightedShareScore } from "../scoring";
import { worstOf, type BreakdownRow, type FindingCandidate, type ScoreResult, type SectionComputation, type Severity, type Signal } from "../types";
import { DRILLDOWN_LIMIT, coverageNote, heatmapRows, kpi, noGraphData, plural, topCaption, worstRowFirst, type DrilldownResult, type SectionContext } from "./shared";

// Metadata health: how big and how tightly connected each object is. Three rules per object:
//   high custom field count, high incoming relationship degree, no incoming references.
// An object "breaches" a rule when it is at or beyond the threshold AND the rule's signal scores above
// Good, so a managed-package object (whose signals are dampened) is not nagged about what it cannot change.

type Classification = "standard" | "custom" | "managed";
const CLASS_LABEL: Record<Classification, string> = { standard: "Salesforce Standard", custom: "Unmanaged Custom", managed: "Managed Package" };
const RELATIONSHIP_EDGES = [edgeTypeKey("LOOKUP_TO"), edgeTypeKey("MASTER_DETAIL_TO")];

export function classify(node: Pick<StoredNode, "namespace" | "fqn" | "attributes">): Classification {
  if (node.namespace) return "managed";
  if (node.attributes.custom === true || /__c$/i.test(node.fqn)) return "custom";
  return "standard";
}

type ObjectEval = {
  node: StoredNode;
  classification: Classification;
  fields: number;
  degree: number;
  field: { signal: Signal; score: ScoreResult; breached: boolean };
  rel: { signal: Signal; score: ScoreResult; breached: boolean };
  orphan: { signal: Signal; score: ScoreResult; breached: boolean };
  severity: Severity;
};

async function evaluate(ctx: SectionContext): Promise<{ objects: ObjectEval[]; ceilingReached: boolean }> {
  const { graph, connectionId, config } = ctx;
  const m = config.metadata;
  const nodes = await graph.browseNodes(connectionId, nodeTypeKey("CustomObject"), config.ceiling);
  const keys = nodes.map((n) => n.nodeKey);
  const [fieldCounts, incoming] = await Promise.all([graph.customFieldCounts(connectionId, keys), graph.incomingCounts(connectionId, keys, RELATIONSHIP_EDGES)]);

  const objects = nodes.map((node): ObjectEval => {
    const classification = classify(node);
    const managed = classification === "managed";
    const fields = fieldCounts.get(node.nodeKey) ?? 0;
    const degree = incoming.get(node.nodeKey) ?? 0;

    const fieldSignal: Signal = {
      key: "FieldCountMagnitude",
      label: "Custom field count",
      weight: PRIMARY_SIGNAL_WEIGHT,
      magnitude: fields / m.fieldThreshold,
      confidence: 0.75,
      impactMultiplier: managed ? 0.4 : 1,
      // A heavily referenced object is more exposed to a messy field list.
      exposureMultiplier: degree >= m.degreeThreshold ? 1.15 : 1,
      note: `${fields} custom fields vs. threshold ${m.fieldThreshold}`,
    };
    const relSignal: Signal = {
      key: "DegreeMagnitude",
      label: "Incoming relationship degree",
      weight: PRIMARY_SIGNAL_WEIGHT,
      magnitude: degree / m.degreeThreshold,
      confidence: 0.8,
      impactMultiplier: managed ? 0.6 : 1,
      note: `${degree} incoming relationships vs. threshold ${m.degreeThreshold}`,
    };
    const orphanSignal: Signal = {
      key: "NoIncomingReferences",
      label: "No incoming references detected",
      weight: NO_REFERENCES_SIGNAL_WEIGHT,
      magnitude: degree === 0 ? 1.5 : 0,
      confidence: 1,
      impactMultiplier: managed ? 0.5 : 0.7,
      note: degree === 0 ? "No incoming relationships detected within the current scan" : "",
    };

    const judge = (signal: Signal, held: boolean) => {
      const score = scoreSignals([signal]);
      return { signal, score, breached: held && score.severity !== "good" };
    };
    const field = judge(fieldSignal, fields >= m.fieldThreshold);
    const rel = judge(relSignal, degree >= m.degreeThreshold);
    const orphan = judge(orphanSignal, degree === 0);
    const severity = worstOf(field.breached ? field.score.severity : "good", rel.breached ? rel.score.severity : "good", orphan.breached ? orphan.score.severity : "good");
    return { node, classification, fields, degree, field, rel, orphan, severity };
  });
  return { objects, ceilingReached: nodes.length >= config.ceiling };
}

function explain(o: ObjectEval, ctx: SectionContext): string {
  const m = ctx.config.metadata;
  const reasons: string[] = [];
  if (o.field.breached) reasons.push(`${plural(o.fields, "custom field")} — at or above this org's threshold of ${m.fieldThreshold}.`);
  if (o.rel.breached) reasons.push(`${plural(o.degree, "incoming relationship edge")} — at or above this org's threshold of ${m.degreeThreshold}.`);
  if (o.orphan.breached) reasons.push("No incoming references detected within the current scan — nothing appears to point to this object yet (not proof it is unused).");
  return reasons.length > 0 ? reasons.join(" ") : "No thresholds breached — field count and connectivity are within this org's configured ranges.";
}

function toRow(o: ObjectEval, ctx: SectionContext): BreakdownRow {
  return {
    key: o.node.nodeKey,
    label: o.node.label,
    componentType: CLASS_LABEL[o.classification],
    severity: o.severity,
    metrics: [
      { column: "Fields", value: String(o.fields) },
      { column: "Degree", value: String(o.degree) },
      { column: "No refs detected", value: o.orphan.breached ? "Y" : "N" },
    ],
    explanation: explain(o, ctx),
  };
}

const byAttention = (a: ObjectEval, b: ObjectEval) => worstRowFirst(a, b) || b.fields + b.degree - (a.fields + a.degree) || a.node.label.localeCompare(b.node.label);

export async function computeMetadata(ctx: SectionContext): Promise<SectionComputation> {
  const { config, now } = ctx;
  const m = config.metadata;
  const { objects, ceilingReached } = await evaluate(ctx);
  if (objects.length === 0) return { result: noGraphData("metadata", "Metadata", true, now, "objects"), candidates: [] };

  const total = objects.length;
  const highField = objects.filter((o) => o.field.breached).length;
  const highDegree = objects.filter((o) => o.rel.breached).length;
  const orphans = objects.filter((o) => o.orphan.breached).length;
  const score = weightedShareScore(total, [
    { count: highField, weight: m.fieldWeight },
    { count: highDegree, weight: m.degreeWeight },
    { count: orphans, weight: m.orphanWeight },
  ]);
  const density = objects.reduce((sum, o) => sum + o.degree, 0) / total;

  const needing = objects.filter((o) => o.severity !== "good").sort(byAttention);
  const rows = needing.slice(0, 8).map((o) => toRow(o, ctx));
  const columns = ["Fields", "Degree"];

  return {
    result: {
      section: "metadata",
      label: "Metadata",
      scored: true,
      score,
      severity: score === null ? null : severityOf(score),
      basis: "scan",
      computedAt: now.toISOString(),
      coverage: coverageNote(total, "objects", ceilingReached),
      kpis: [
        kpi("HighFieldCount", "High field-count objects", highField, "HighFieldCount"),
        kpi("HighDegree", "High-degree objects", highDegree, "HighDegree"),
        kpi("OrphanRate", "No incoming references detected", orphans, "OrphanRate"),
        kpi("DependencyDensity", "Dependency density", density.toFixed(1), "DependencyDensity"),
      ],
      formula: {
        summary: "100 minus a weighted penalty for each rule below that an object breaches.",
        components: [
          { label: `High custom field count — objects with ≥ ${m.fieldThreshold} custom fields`, weight: `${m.fieldWeight}%` },
          { label: `High degree — objects with ≥ ${m.degreeThreshold} relationship edges`, weight: `${m.degreeWeight}%` },
          { label: "No-incoming-reference rate — objects with 0 incoming relationship edges detected within current scan coverage (not proof the object is unused)", weight: `${m.orphanWeight}%` },
        ],
      },
      breakdown: { title: "Objects needing attention", caption: topCaption(rows.length, needing.length), columns, rows },
      heatmap: { columns: ["Fields", "Degree", "No refs detected"], rows: heatmapRows(needing.map((o) => toRow(o, ctx)), ["Fields", "Degree", "No refs detected"], 5) },
      facts: [],
      unavailable: [],
    },
    candidates: objects.flatMap((o) => candidatesFor(o, ctx)),
  };
}

export async function metadataDrilldown(ctx: SectionContext, metricKey: string): Promise<DrilldownResult> {
  const { objects } = await evaluate(ctx);
  const columns = ["Fields", "Degree", "No refs detected"];
  let title: string;
  let picked: ObjectEval[];
  switch (metricKey) {
    case "HighFieldCount":
      title = "High field-count objects";
      picked = objects.filter((o) => o.field.breached).sort((a, b) => b.fields - a.fields);
      break;
    case "HighDegree":
      title = "High-degree objects";
      picked = objects.filter((o) => o.rel.breached).sort((a, b) => b.degree - a.degree);
      break;
    case "OrphanRate":
      title = "Objects with no incoming references detected";
      picked = objects.filter((o) => o.orphan.breached).sort((a, b) => a.node.label.localeCompare(b.node.label));
      break;
    default:
      title = "Objects ranked by relationship degree";
      picked = [...objects].sort((a, b) => b.degree - a.degree || a.node.label.localeCompare(b.node.label));
  }
  const rows = picked.slice(0, DRILLDOWN_LIMIT).map((o) => toRow(o, ctx));
  return { title, caption: rows.length >= picked.length ? plural(picked.length, "object") : `Top ${rows.length} of ${picked.length}`, columns, rows };
}

function candidatesFor(o: ObjectEval, ctx: SectionContext): FindingCandidate[] {
  const m = ctx.config.metadata;
  const label = o.node.label;
  const managed = o.classification === "managed";
  const base = { section: "metadata" as const, ruleVersion: 2, componentKey: o.node.nodeKey, componentType: CLASS_LABEL[o.classification], componentLabel: label };
  const vendor = managed ? " This object belongs to a managed package, so raise it with the package vendor rather than changing it." : "";
  const out: FindingCandidate[] = [];

  if (o.field.breached) {
    out.push({
      ...base,
      ruleKey: "MetadataHealth.HighFieldCount",
      title: `${label} has an unusually high custom field count`,
      severity: o.field.score.severity,
      confidence: "medium",
      score: o.field.score.badness,
      evidence: `${plural(o.fields, "custom field")} detected on ${label} (configured threshold: ${m.fieldThreshold}). ${o.field.score.explanation}`,
      measured: `${plural(o.fields, "custom field")}`,
      expected: `< ${m.fieldThreshold} custom fields`,
      explanation: `${label} carries ${o.fields} custom fields, at or above this org's threshold of ${m.fieldThreshold}. ${o.field.score.explanation}`,
      risk: "Objects with very many fields are harder to understand, slower to lay out and report on, and closer to platform limits.",
      impact: "Admins and developers spend longer finding the right field; page layouts, reports and integrations that touch this object become harder to maintain.",
      remediation: `Review the fields for duplicates and for fields that are no longer populated, and consider moving rarely used groups of fields to a related object.${vendor}`,
      validation: `Re-run the scan after the clean-up; the custom field count should fall below ${m.fieldThreshold}.`,
      contributors: o.field.score.contributors,
    });
  }
  if (o.rel.breached) {
    out.push({
      ...base,
      ruleKey: "MetadataHealth.HighDegree",
      title: `${label} has an unusually high number of incoming relationships`,
      severity: o.rel.score.severity,
      confidence: "medium",
      score: o.rel.score.badness,
      evidence: `${plural(o.degree, "incoming lookup/master-detail relationship edge")} detected (configured threshold: ${m.degreeThreshold}). ${o.rel.score.explanation}`,
      measured: `${plural(o.degree, "incoming relationship")}`,
      expected: `< ${m.degreeThreshold} incoming relationships`,
      explanation: `${o.degree} other objects point at ${label} through lookup or master-detail fields, at or above this org's threshold of ${m.degreeThreshold}. ${o.rel.score.explanation}`,
      risk: "A heavily referenced object is a hub: changes to it, or to its records, ripple out to many other objects.",
      impact: "Deleting, reparenting or restructuring data on this object touches many relationships; sharing and roll-up behaviour is harder to reason about.",
      remediation: `Check whether every relationship is still needed, and whether some could point at a more specific parent object.${vendor}`,
      validation: `Re-run the scan after the change; incoming relationships should fall below ${m.degreeThreshold}.`,
      contributors: o.rel.score.contributors,
    });
  }
  if (o.orphan.breached) {
    out.push({
      ...base,
      ruleKey: "MetadataHealth.NoIncomingReferences",
      title: `No incoming references detected for ${label}`,
      severity: o.orphan.score.severity,
      confidence: "low",
      score: o.orphan.score.badness,
      evidence: `No incoming lookup or master-detail relationship to ${label} was detected within the current scan coverage. ${o.orphan.score.explanation}`,
      measured: "0 incoming relationships",
      expected: "Not applicable — informational, for review only",
      explanation: `Nothing in the scanned scope points at ${label}. That can be perfectly normal (a standalone object) and is not proof that the object is unused.`,
      risk: "An object that nothing relates to may be abandoned, or may simply sit outside the scanned scope.",
      impact: "Unused objects add clutter and storage; objects outside the scan scope are invisible to this analysis.",
      remediation: `Confirm whether ${label} is still in use (records, reports, automation). If it is intentional, mark this finding Risk Accepted.${vendor}`,
      validation: "Re-run the scan after widening the scope or retiring the object.",
      contributors: o.orphan.score.contributors,
    });
  }
  return out;
}
