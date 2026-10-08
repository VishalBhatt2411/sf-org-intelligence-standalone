import type { FindingCandidate, FindingSection } from "../types";
import { CLOSED_STATUSES, SYSTEM_ACTOR, fingerprintOf, type FindingRepository, type NewFinding, type NewFindingEvent } from "./findingTypes";

export type SyncOptions = {
  runId: string | null;
  now: Date;
  // False when the section could not see everything: a finding that is merely absent from a partial run
  // is not evidence that the problem went away, so nothing is auto-resolved.
  autoResolve: boolean;
};

export type SyncOutcome = { created: number; refreshed: number; reopened: number; resolved: number };

const DETECTION_FIELDS = ["ruleVersion", "componentType", "componentLabel", "title", "severity", "confidence", "score", "evidence", "measured", "expected", "explanation", "risk", "impact", "remediation", "validation", "contributors"] as const;

const detection = (c: FindingCandidate) => Object.fromEntries(DETECTION_FIELDS.map((k) => [k, c[k]])) as Pick<FindingCandidate, (typeof DETECTION_FIELDS)[number]>;

// Brings the stored findings of one section in line with what the latest run proposed:
//  - new candidate: stored as open;
//  - known candidate: detection fields refreshed, triage fields untouched; a resolved finding that is
//    detected again reopens (with a note in its evidence); risk_accepted and false_positive stay as they are;
//  - stored finding no longer proposed: auto-resolved, unless it is a false positive; nothing is deleted.
// Candidates sharing a fingerprint collapse to the last one.
export async function syncFindings(repo: FindingRepository, connectionId: string, section: FindingSection, candidates: FindingCandidate[], options: SyncOptions): Promise<SyncOutcome> {
  const { runId, now, autoResolve } = options;
  const byFingerprint = new Map<string, FindingCandidate>();
  for (const c of candidates) {
    if (c.section !== section) throw new Error(`Candidate for section ${c.section} offered to the ${section} sync`);
    byFingerprint.set(fingerprintOf(c.section, c.ruleKey, c.componentKey), c);
  }

  const existing = new Map((await repo.syncView(connectionId, section)).map((e) => [e.fingerprint, e]));
  const outcome: SyncOutcome = { created: 0, refreshed: 0, reopened: 0, resolved: 0 };
  const fresh: NewFinding[] = [];
  const events: NewFindingEvent[] = [];

  for (const [fingerprint, candidate] of byFingerprint) {
    const known = existing.get(fingerprint);
    if (!known) {
      fresh.push({ ...candidate, fingerprint, lastRunId: runId, detectedAt: now });
      outcome.created += 1;
      continue;
    }
    if (known.status === "resolved") {
      const since = known.resolvedAt ? ` on ${known.resolvedAt.toISOString().slice(0, 10)}` : "";
      await repo.update(connectionId, known.id, { ...detection(candidate), evidence: `${candidate.evidence} Reopened: detected again after being resolved${since}.`, status: "open", resolvedAt: null, lastDetectedAt: now, lastRunId: runId });
      events.push({ findingId: known.id, field: "status", oldValue: "resolved", newValue: "open", changedBy: SYSTEM_ACTOR, changedAt: now });
      outcome.reopened += 1;
    } else {
      await repo.update(connectionId, known.id, { ...detection(candidate), lastDetectedAt: now, lastRunId: runId });
      outcome.refreshed += 1;
    }
  }

  if (fresh.length > 0) await repo.insertMany(connectionId, fresh);

  if (autoResolve) {
    const gone = [...existing.entries()].filter(([fp, e]) => !byFingerprint.has(fp) && e.status !== "resolved" && !CLOSED_STATUSES.includes(e.status));
    if (gone.length > 0) {
      await repo.resolveMany(connectionId, gone.map(([, e]) => e.id), now, runId);
      for (const [, e] of gone) events.push({ findingId: e.id, field: "status", oldValue: e.status, newValue: "resolved", changedBy: SYSTEM_ACTOR, changedAt: now });
      outcome.resolved = gone.length;
    }
  }

  if (events.length > 0) await repo.addEvents(events);
  return outcome;
}
