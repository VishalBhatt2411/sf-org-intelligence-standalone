import { GOOD_FROM, MAGNITUDE_CAP, WARNING_FROM } from "./config";
import type { Contributor, ScoreResult, Severity, Signal } from "./types";

// The one scoring engine behind every Org Health number. A signal contributes
//   weight x min(magnitude, 1.5)/1.5 x confidence x impact x exposure (x 0.5 with a compensating control)
// points of "badness"; signals describing the same problem (same correlationGroup) combine by taking
// the largest, so one root cause is never counted twice; the winners add up and are clamped to 0..100.
// Health is 100 minus that, and severity bands are half-open: health 70 is Good, 40 is Warning.

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number, places: number) => {
  const f = 10 ** places;
  return Math.round((n + Number.EPSILON) * f) / f;
};

export function severityOf(health: number): Severity {
  return health >= GOOD_FROM ? "good" : health >= WARNING_FROM ? "warning" : "critical";
}

function contributionOf(s: Signal): number {
  const magnitude = clamp(Number.isFinite(s.magnitude) ? s.magnitude : 0, 0, MAGNITUDE_CAP);
  const confidence = clamp(s.confidence ?? 1, 0, 1);
  const raw = s.weight * (magnitude / MAGNITUDE_CAP) * confidence * (s.impactMultiplier ?? 1) * (s.exposureMultiplier ?? 1);
  return Math.max(0, s.hasCompensatingControl ? raw * 0.5 : raw);
}

export function scoreSignals(signals: Signal[]): ScoreResult {
  const scored = signals.map((s) => ({ s, value: contributionOf(s) }));

  // Winner per correlation group; an ungrouped signal is its own group.
  const winners = new Map<string, number>();
  scored.forEach((c, i) => {
    const group = c.s.correlationGroup ?? `\u0000${i}`;
    const best = winners.get(group);
    if (best === undefined || c.value > scored[best].value) winners.set(group, i);
  });
  const winning = new Set(winners.values());

  const contributors: Contributor[] = scored.map((c, i) => ({
    key: c.s.key,
    label: c.s.label,
    weight: c.s.weight,
    magnitude: round(c.s.magnitude, 2),
    confidence: clamp(c.s.confidence ?? 1, 0, 1),
    impactMultiplier: c.s.impactMultiplier ?? 1,
    exposureMultiplier: c.s.exposureMultiplier ?? 1,
    hasCompensatingControl: c.s.hasCompensatingControl ?? false,
    wasCorrelatedOut: !winning.has(i),
    contribution: round(winning.has(i) ? c.value : 0, 2),
    note: c.s.note ?? "",
  }));

  const total = [...winning].reduce((sum, i) => sum + scored[i].value, 0);
  const badness = round(clamp(total, 0, 100), 1);
  const health = round(100 - badness, 1);
  const severity = severityOf(health);

  return { badness, health, severity, explanation: explain(severity, contributors, signals.length), contributors };
}

function explain(severity: Severity, contributors: Contributor[], signalCount: number): string {
  const name = `Severity ${severity[0].toUpperCase()}${severity.slice(1)}`;
  if (signalCount === 0) return "No signals evaluated — nothing detected.";
  const top = contributors
    .filter((c) => c.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2);
  if (top.length === 0) return `${name} — no individual signal contributed meaningfully; see contributor detail.`;
  const parts = top.map((c) => {
    const points = c.contribution === 1 ? "1 point" : `${c.contribution} points`;
    return `${c.label} contributed ${points}${c.hasCompensatingControl ? " (halved by a recorded compensating control)" : ""}`;
  });
  return `${name} because: ${parts.join("; ")}.`;
}

// Section-level score from the share of items that breach each rule: 100 minus the weighted share,
// rounded to a whole number. Null when there was nothing to score, so an empty org is "no data", not 100.
export function weightedShareScore(total: number, parts: Array<{ count: number; weight: number }>): number | null {
  if (total <= 0) return null;
  const penalty = parts.reduce((sum, p) => sum + (p.count / total) * p.weight, 0);
  return clamp(Math.round(100 - penalty + Number.EPSILON), 0, 100);
}
