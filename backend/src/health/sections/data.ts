import { namespaceFromApiName, nodeKeyFor } from "../../graph/keys";
import { PRIMARY_SIGNAL_WEIGHT, RATE_SIGNAL_CONFIDENCE } from "../config";
import type { ObjectProfile } from "../healthSource";
import { scoreSignals, severityOf, weightedShareScore } from "../scoring";
import { worstOf, type BreakdownRow, type FindingCandidate, type ScoreResult, type SectionComputation, type Severity } from "../types";
import { errorText, heatmapRows, liveKpi, plural, topCaption, worstRowFirst, type LiveSectionContext } from "./shared";

// Data health (scored, live, sampled): how stale, incomplete and duplicated the records of a few key
// objects are. Stale records are counted exactly (two COUNT() queries per object). Completeness and
// duplicates are measured on a sample of up to `sampleCeiling` records per object, ordered by Id so the
// sample is repeatable; the section says so rather than presenting sample rates as whole-object facts.
// Duplicates are exact matches on the configured key fields (case and surrounding spaces ignored).

type Rule = "stale" | "incomplete" | "duplicates";
type Rate = { value: number | null; breached: boolean; score: ScoreResult | null };

type Row = {
  object: string;
  total: number;
  stale: number;
  sampled: number;
  incomplete: number | null;
  duplicates: number | null;
  rates: Record<Rule, Rate>;
  severity: Severity;
  skipped: string[];
};

const objectKey = (object: string): string => nodeKeyFor("CustomObject", namespaceFromApiName(object), object);
const pct = (n: number, of: number): number => (of > 0 ? (n / of) * 100 : 0);
const fmt = (n: number | null): string => (n === null ? "—" : `${Math.round(n * 10) / 10}%`);
const norm = (v: string | null): string => (v ?? "").trim().toLowerCase();
const blank = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === "";

function measure(profile: ObjectProfile, completeness: string[], keys: string[]) {
  const have = new Set([...completeness, ...keys].filter((f) => !profile.missingFields.includes(f)));
  const fields = completeness.filter((f) => have.has(f));
  const keyFields = keys.length > 0 && keys.every((f) => have.has(f)) ? keys : [];
  const incomplete = fields.length > 0 ? profile.sample.filter((r) => fields.some((f) => blank(r[f]))).length : null;
  let duplicates: number | null = null;
  if (keyFields.length > 0) {
    const seen = new Set<string>();
    duplicates = 0;
    for (const r of profile.sample) {
      // A record with an empty key part cannot be matched; it is neither a duplicate nor a first.
      if (keyFields.some((f) => blank(r[f]))) continue;
      const id = keyFields.map((f) => norm(r[f])).join("\u0000");
      if (seen.has(id)) duplicates++;
      else seen.add(id);
    }
  }
  return { incomplete, duplicates, skipped: [...completeness.filter((f) => !have.has(f)), ...keys.filter((f) => !have.has(f))] };
}

function rate(label: string, key: string, value: number | null, threshold: number): Rate {
  if (value === null) return { value: null, breached: false, score: null };
  const score = scoreSignals([{ key, label, weight: PRIMARY_SIGNAL_WEIGHT, magnitude: value / threshold, confidence: RATE_SIGNAL_CONFIDENCE, note: `${fmt(value)} vs. threshold ${threshold}%` }]);
  return { value, breached: value >= threshold && score.severity !== "good", score };
}

export async function computeData(ctx: LiveSectionContext): Promise<SectionComputation> {
  const { source, config, now } = ctx;
  const d = config.data;
  const staleBefore = new Date(now.getTime() - d.staleDays * 86_400_000);
  const unavailable: string[] = [];
  const rows: Row[] = [];

  for (const object of d.objects) {
    const completeness = d.completenessFields[object] ?? [];
    const keys = d.duplicateKeys[object] ?? [];
    let profile: ObjectProfile;
    try {
      profile = await source.objectProfile(object, [...completeness, ...keys], staleBefore, d.sampleCeiling);
    } catch (err) {
      console.warn(`org health: data profile of "${object}" failed:`, errorText(err));
      unavailable.push(`${object} could not be read`);
      continue;
    }
    const m = measure(profile, completeness, keys);
    const sampled = profile.sample.length;
    const rates: Record<Rule, Rate> = {
      stale: rate("Stale records", "StaleRecords", profile.total > 0 ? pct(profile.stale, profile.total) : null, d.staleThresholdPercent),
      incomplete: rate("Incomplete records", "Completeness", m.incomplete === null || sampled === 0 ? null : pct(m.incomplete, sampled), d.incompleteThresholdPercent),
      duplicates: rate("Duplicate records", "Duplicates", m.duplicates === null || sampled === 0 ? null : pct(m.duplicates, sampled), d.duplicateThresholdPercent),
    };
    const severity = worstOf(...(Object.values(rates).map((r) => (r.breached && r.score ? r.score.severity : "good")) as Severity[]));
    rows.push({ object: profile.object, total: profile.total, stale: profile.stale, sampled, incomplete: m.incomplete, duplicates: m.duplicates, rates, severity, skipped: m.skipped });
    for (const f of m.skipped) unavailable.push(`${profile.object}.${f} is not available on this org and was skipped`);
  }

  const profiled = rows.length;
  const withData = rows.filter((r) => r.total > 0);
  const score = weightedShareScore(withData.length, [
    { count: withData.filter((r) => r.rates.stale.breached).length, weight: d.staleWeight },
    { count: withData.filter((r) => r.rates.incomplete.breached).length, weight: d.completenessWeight },
    { count: withData.filter((r) => r.rates.duplicates.breached).length, weight: d.duplicatesWeight },
  ]);

  const attention = rows.filter((r) => r.severity !== "good").sort((a, b) => worstRowFirst(a, b) || a.object.localeCompare(b.object));
  const shown = attention.slice(0, 8).map(toRow);
  const sampledTotal = rows.reduce((a, r) => a + r.sampled, 0);

  const noteParts = [`${profiled} of ${d.objects.length} objects profiled`];
  if (profiled > 0) noteParts.push(`stale records counted across all records; completeness and duplicates measured on a sample of up to ${d.sampleCeiling} records per object`);
  if (withData.length < profiled) noteParts.push(`${plural(profiled - withData.length, "object")} had no records and was not scored`);

  return {
    result: {
      section: "data",
      label: "Data",
      scored: true,
      score,
      severity: score === null ? null : severityOf(score),
      basis: "live",
      computedAt: now.toISOString(),
      coverage: { complete: unavailable.length === 0 && profiled === d.objects.length, note: noteParts.join("; ") },
      kpis: [
        liveKpi("Profiled", "Objects profiled", profiled),
        liveKpi("StaleRecords", "Stale records", rows.reduce((a, r) => a + r.stale, 0)),
        liveKpi("Sampled", "Records sampled", sampledTotal),
        liveKpi("ObjectsWithIssues", "Objects with issues", attention.length),
      ],
      formula: {
        summary: "100 minus a weighted penalty for each rule below, in proportion to how many of the profiled objects breach it. Objects with no records are left out.",
        components: [
          { label: `Stale — records not modified in ${d.staleDays} days, at or above ${d.staleThresholdPercent}%`, weight: `${d.staleWeight}%` },
          { label: `Incomplete — sampled records missing a key field, at or above ${d.incompleteThresholdPercent}%`, weight: `${d.completenessWeight}%` },
          { label: `Duplicates — sampled records matching another on the key fields, at or above ${d.duplicateThresholdPercent}%`, weight: `${d.duplicatesWeight}%` },
        ],
      },
      breakdown: { title: "Objects needing attention", caption: topCaption(shown.length, attention.length), columns: ["Records", "Stale", "Incomplete", "Duplicates"], rows: shown },
      heatmap: { columns: ["Stale", "Incomplete", "Duplicates"], rows: heatmapRows(attention.map(toRow), ["Stale", "Incomplete", "Duplicates"], 5) },
      facts: [],
      unavailable,
    },
    candidates: rows.flatMap((r) => candidatesFor(r, d)),
  };
}

const toRow = (r: Row): BreakdownRow => ({
  key: objectKey(r.object),
  label: r.object,
  componentType: "Object",
  severity: r.severity,
  metrics: [
    { column: "Records", value: String(r.total) },
    { column: "Stale", value: fmt(r.rates.stale.value) },
    { column: "Incomplete", value: fmt(r.rates.incomplete.value) },
    { column: "Duplicates", value: fmt(r.rates.duplicates.value) },
  ],
  explanation: explain(r),
});

function explain(r: Row): string {
  const parts: string[] = [];
  if (r.rates.stale.breached) parts.push(`${fmt(r.rates.stale.value)} of ${r.total} records are stale.`);
  if (r.rates.incomplete.breached) parts.push(`${fmt(r.rates.incomplete.value)} of the ${r.sampled} sampled records are missing a key field.`);
  if (r.rates.duplicates.breached) parts.push(`${fmt(r.rates.duplicates.value)} of the ${r.sampled} sampled records match another on the key fields.`);
  return parts.length > 0 ? parts.join(" ") : "No thresholds breached — data quality is within this org's configured range.";
}

function candidatesFor(r: Row, d: { staleDays: number; staleThresholdPercent: number; incompleteThresholdPercent: number; duplicateThresholdPercent: number; completenessFields: Record<string, string[]>; duplicateKeys: Record<string, string[]> }): FindingCandidate[] {
  const base = { section: "data" as const, ruleVersion: 1, componentKey: objectKey(r.object), componentType: "Object", componentLabel: r.object };
  const out: FindingCandidate[] = [];
  const stale = r.rates.stale;
  if (stale.breached && stale.score) {
    out.push({
      ...base,
      ruleKey: "DataHealth.StaleRecords",
      title: `${r.object} has many stale records`,
      severity: stale.score.severity,
      confidence: "medium",
      score: stale.score.badness,
      evidence: `${r.stale} of ${r.total} ${r.object} records (${fmt(stale.value)}) have not been modified in ${d.staleDays} days (configured threshold: ${d.staleThresholdPercent}%). ${stale.score.explanation}`,
      measured: `${fmt(stale.value)} stale`,
      expected: `< ${d.staleThresholdPercent}% stale`,
      explanation: `A record that has not been touched in ${d.staleDays} days is likely out of date. Counted across all ${r.total} records, not a sample.`,
      risk: "Outdated records mislead reports and waste storage, and users stop trusting the data.",
      impact: `${plural(r.stale, "record")} may need review, archiving or deletion.`,
      remediation: "Review the oldest records with their owners, then archive or delete what is no longer needed, and add a periodic clean-up.",
      validation: "Run the Data check again; the stale share should fall below the threshold.",
      contributors: stale.score.contributors,
    });
  }
  const inc = r.rates.incomplete;
  if (inc.breached && inc.score) {
    const fields = (d.completenessFields[r.object] ?? []).join(", ");
    out.push({
      ...base,
      ruleKey: "DataHealth.Completeness",
      title: `${r.object} records are often missing key fields`,
      severity: inc.score.severity,
      confidence: "low",
      score: inc.score.badness,
      evidence: `${r.incomplete} of ${r.sampled} sampled ${r.object} records (${fmt(inc.value)}) lack at least one of: ${fields} (configured threshold: ${d.incompleteThresholdPercent}%). ${inc.score.explanation}`,
      measured: `${fmt(inc.value)} incomplete (sample of ${r.sampled})`,
      expected: `< ${d.incompleteThresholdPercent}% incomplete`,
      explanation: `Measured on a sample of ${r.sampled} of ${r.total} records, so the real rate may differ. Key fields checked: ${fields}.`,
      risk: "Missing contact or classification details limit segmentation, routing and reporting.",
      impact: "Records without these fields cannot be reliably reached, grouped or reported on.",
      remediation: "Make the important fields required where the process allows, backfill existing records, and validate on entry.",
      validation: "Run the Data check again; the incomplete share should fall below the threshold.",
      contributors: inc.score.contributors,
    });
  }
  const dup = r.rates.duplicates;
  if (dup.breached && dup.score) {
    const keys = (d.duplicateKeys[r.object] ?? []).join(" + ");
    out.push({
      ...base,
      ruleKey: "DataHealth.Duplicates",
      title: `${r.object} has duplicate records`,
      severity: dup.score.severity,
      confidence: "low",
      score: dup.score.badness,
      evidence: `${r.duplicates} of ${r.sampled} sampled ${r.object} records (${fmt(dup.value)}) match another record on ${keys} (configured threshold: ${d.duplicateThresholdPercent}%). ${dup.score.explanation}`,
      measured: `${fmt(dup.value)} duplicates (sample of ${r.sampled})`,
      expected: `< ${d.duplicateThresholdPercent}% duplicates`,
      explanation: `Exact matches on ${keys}, within a sample of ${r.sampled} of ${r.total} records. Near-matches are not detected.`,
      risk: "Duplicates split history across records and inflate counts.",
      impact: "Users may work from an incomplete copy, and reports double-count.",
      remediation: "Merge the duplicates, and add duplicate rules so new ones are blocked or flagged.",
      validation: "Run the Data check again; the duplicate share should fall below the threshold.",
      contributors: dup.score.contributors,
    });
  }
  return out;
}
