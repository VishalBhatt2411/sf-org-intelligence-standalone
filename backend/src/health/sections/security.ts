import { nodeKeyFor } from "../../graph/keys";
import { PRIMARY_SIGNAL_WEIGHT } from "../config";
import type { ElevatedFlag, SecuritySet } from "../healthSource";
import { scoreSignals } from "../scoring";
import { worstOf, type BreakdownRow, type FindingCandidate, type ScoreResult, type SectionComputation, type SectionResult, type Severity } from "../types";
import { errorText, heatmapRows, liveKpi, plural, topCaption, worstRowFirst, type LiveSectionContext } from "./shared";

// Security health (facts only, unscored, live): custom permission sets and profiles that hold powerful
// permissions, broad object access, or access to sensitive objects. Read live from Salesforce on demand.
// Salesforce-supplied permission sets and managed-package ones are left out: the first cannot be changed
// by the customer and the second belong to a vendor.

// How strongly each permission counts toward the elevated-permissions signal (full strength at the
// configured threshold; ModifyAllData alone is already above it).
const FLAG_POINTS: Record<ElevatedFlag, number> = {
  PermissionsModifyAllData: 1.5,
  PermissionsViewAllData: 1,
  PermissionsManageUsers: 0.75,
  PermissionsAuthorApex: 0.75,
  PermissionsManageProfilesPermissionsets: 0.75,
  PermissionsCustomizeApplication: 0.5,
};
const FLAG_LABEL: Record<ElevatedFlag, string> = {
  PermissionsModifyAllData: "Modify All Data",
  PermissionsViewAllData: "View All Data",
  PermissionsManageUsers: "Manage Users",
  PermissionsAuthorApex: "Author Apex",
  PermissionsManageProfilesPermissionsets: "Manage Profiles and Permission Sets",
  PermissionsCustomizeApplication: "Customize Application",
};
const CONFIDENCE = 0.85;
const BROAD_CONFIDENCE = 0.8;
const SENSITIVE_CONFIDENCE = 0.8;
const WIDELY_ASSIGNED = 25;

type Row = {
  set: SecuritySet;
  users: number | null;
  elevated: { breached: boolean; score: ScoreResult; points: number };
  broad: { breached: boolean; score: ScoreResult; modifyAll: number; viewAll: number };
  sensitive: { breached: boolean; score: ScoreResult; objects: string[]; points: number };
  severity: Severity;
};

// Who is affected scales the risk: nobody holding it halves it, a widely assigned set raises it.
const exposureOf = (users: number | null): number => (users === null ? 1 : users === 0 ? 0.5 : users >= WIDELY_ASSIGNED ? 1.2 : 1);

export async function computeSecurity(ctx: LiveSectionContext): Promise<SectionComputation> {
  const { source, config, now } = ctx;
  const sec = config.security;
  const unavailable: string[] = [];
  const read = async <T>(what: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      console.warn(`org health: security read "${what}" failed:`, errorText(err));
      unavailable.push(`${what} could not be read`);
      return null;
    }
  };

  const sets = await read("Permission sets", () => source.securitySets(config.ceiling));
  if (!sets) return { result: base(ctx, unavailable, { complete: false, note: "Permission sets could not be read, so nothing was evaluated." }), candidates: [] };

  const [broad, sensitive, assignments] = await Promise.all([
    read("Object access (View All / Modify All)", () => source.broadGrants()),
    read("Sensitive object access", () => source.sensitiveGrants(sec.sensitiveObjects, config.ceiling * 10)),
    read("Permission set assignments", () => source.assignmentCounts()),
  ]);

  const reviewed = sets.sets.filter((s) => !s.namespace);
  const managed = sets.sets.length - reviewed.length;
  const broadBy = new Map((broad ?? []).map((b) => [b.permissionSetId, b]));
  const sensitiveBy = new Map<string, NonNullable<typeof sensitive>["grants"]>();
  for (const g of sensitive?.grants ?? []) sensitiveBy.set(g.permissionSetId, [...(sensitiveBy.get(g.permissionSetId) ?? []), g]);

  const rows = reviewed.map((set): Row => {
    const users = assignments ? (assignments.get(set.id) ?? 0) : null;
    const exposure = exposureOf(users);

    const elevatedPoints = set.flags.reduce((sum, f) => sum + FLAG_POINTS[f], 0);
    const elevatedScore = scoreSignals([
      { key: "ElevatedPermissions", label: "Elevated permissions", weight: PRIMARY_SIGNAL_WEIGHT, magnitude: elevatedPoints / sec.threshold, confidence: CONFIDENCE, exposureMultiplier: exposure, note: set.flags.map((f) => FLAG_LABEL[f]).join(", ") },
    ]);

    const b = broadBy.get(set.id) ?? { modifyAll: 0, viewAll: 0 };
    const broadPoints = b.modifyAll + b.viewAll * 0.5;
    const broadScore = scoreSignals([
      { key: "BroadObjectGrant", label: "Broad object access", weight: PRIMARY_SIGNAL_WEIGHT, magnitude: broadPoints / sec.broadObjectThreshold, confidence: BROAD_CONFIDENCE, exposureMultiplier: exposure, note: `${b.modifyAll} Modify All, ${b.viewAll} View All` },
    ]);

    const grants = sensitiveBy.get(set.id) ?? [];
    const byObject = new Map<string, number>();
    for (const g of grants) byObject.set(g.object, Math.max(byObject.get(g.object) ?? 0, (g.modifyAll ? 1 : g.viewAll ? 0.75 : 0) + (g.delete ? 0.5 : 0)));
    const sensitivePoints = [...byObject.values()].reduce((a, c) => a + c, 0);
    const sensitiveScore = scoreSignals([
      { key: "SensitiveObjectGrant", label: "Sensitive object access", weight: PRIMARY_SIGNAL_WEIGHT, magnitude: sensitivePoints / sec.threshold, confidence: SENSITIVE_CONFIDENCE, exposureMultiplier: exposure, note: [...byObject.keys()].join(", ") },
    ]);

    // A breach needs the signal to count for something, not just a non-zero grant.
    const elevated = { breached: set.flags.length > 0 && elevatedPoints >= sec.threshold && elevatedScore.severity !== "good", score: elevatedScore, points: elevatedPoints };
    const broadRow = { breached: broadPoints >= sec.broadObjectThreshold && broadScore.severity !== "good", score: broadScore, modifyAll: b.modifyAll, viewAll: b.viewAll };
    const sens = { breached: sensitivePoints >= sec.threshold && sensitiveScore.severity !== "good", score: sensitiveScore, objects: [...byObject.keys()].sort(), points: sensitivePoints };
    return {
      set,
      users,
      elevated,
      broad: broadRow,
      sensitive: sens,
      severity: worstOf(elevated.breached ? elevatedScore.severity : "good", broadRow.breached ? broadScore.severity : "good", sens.breached ? sensitiveScore.severity : "good"),
    };
  });

  const attention = rows.filter((r) => r.severity !== "good").sort((a, b) => worstRowFirst(a, b) || (b.users ?? 0) - (a.users ?? 0) || a.set.label.localeCompare(b.set.label));
  const shown = attention.slice(0, 8).map(toRow);

  const notes: string[] = [`${plural(reviewed.length, "custom permission set or profile", "custom permission sets and profiles")} reviewed`];
  if (managed > 0) notes.push(`${managed} managed-package ${managed === 1 ? "set" : "sets"} skipped`);
  if (sets.truncated) notes.push("ceiling reached — results may be incomplete");
  if (sensitive?.truncated) notes.push("sensitive object access was truncated");
  const complete = !sets.truncated && !sensitive?.truncated && unavailable.length === 0;

  const result = base(ctx, unavailable, { complete, note: notes.join("; ") });
  result.kpis = [
    liveKpi("Reviewed", "Permission sets and profiles reviewed", reviewed.length),
    liveKpi("Elevated", "With elevated permissions", rows.filter((r) => r.elevated.breached).length),
    liveKpi("Broad", "With broad object access", rows.filter((r) => r.broad.breached).length),
    liveKpi("Sensitive", "With sensitive object access", rows.filter((r) => r.sensitive.breached).length),
  ];
  result.breakdown = { title: "Permission sets needing attention", caption: topCaption(shown.length, attention.length), columns: ["Elevated", "Broad objects", "Sensitive", "Users"], rows: shown };
  result.heatmap = { columns: ["Elevated", "Broad objects", "Sensitive", "Users"], rows: heatmapRows(attention.map(toRow), ["Elevated", "Broad objects", "Sensitive", "Users"], 5) };
  return { result, candidates: rows.flatMap((r) => candidatesFor(r, sec)) };
}

function base(ctx: LiveSectionContext, unavailable: string[], coverage: { complete: boolean; note: string }): SectionResult {
  return {
    section: "security",
    label: "Security",
    scored: false,
    score: null,
    severity: null,
    basis: "live",
    computedAt: ctx.now.toISOString(),
    coverage,
    kpis: [],
    formula: null,
    breakdown: { title: "", caption: "", columns: [], rows: [] },
    heatmap: { columns: [], rows: [] },
    facts: [],
    unavailable,
  };
}

const typeOf = (set: SecuritySet) => (set.profileOwned ? "Profile" : "Permission Set");

const toRow = (r: Row): BreakdownRow => ({
  key: nodeKeyFor("PermissionSet", r.set.namespace, r.set.name),
  label: r.set.label,
  componentType: typeOf(r.set),
  severity: r.severity,
  metrics: [
    { column: "Elevated", value: r.set.flags.length > 0 ? String(r.set.flags.length) : "0" },
    { column: "Broad objects", value: String(r.broad.modifyAll + r.broad.viewAll) },
    { column: "Sensitive", value: String(r.sensitive.objects.length) },
    { column: "Users", value: r.users === null ? "—" : String(r.users) },
  ],
  explanation: explain(r),
});

function explain(r: Row): string {
  const parts: string[] = [];
  if (r.elevated.breached) parts.push(`Holds ${r.set.flags.map((f) => FLAG_LABEL[f]).join(", ")}.`);
  if (r.broad.breached) parts.push(`Grants Modify All on ${plural(r.broad.modifyAll, "object")} and View All on ${plural(r.broad.viewAll, "object")}.`);
  if (r.sensitive.breached) parts.push(`Grants wide access to ${r.sensitive.objects.join(", ")}.`);
  return parts.length > 0 ? parts.join(" ") : "No thresholds breached — permissions are within this org's configured range.";
}

function candidatesFor(r: Row, sec: { threshold: number; broadObjectThreshold: number }): FindingCandidate[] {
  const label = r.set.label;
  const kind = typeOf(r.set);
  const users = r.users === null ? "an unknown number of users" : plural(r.users, "user");
  const base = { section: "security" as const, ruleVersion: 1, componentKey: nodeKeyFor("PermissionSet", r.set.namespace, r.set.name), componentType: kind, componentLabel: label };
  const out: FindingCandidate[] = [];
  if (r.elevated.breached) {
    const names = r.set.flags.map((f) => FLAG_LABEL[f]);
    out.push({
      ...base,
      ruleKey: "SecurityHealth.ElevatedPermissions",
      title: `${label} holds elevated permissions`,
      severity: r.elevated.score.severity,
      confidence: "high",
      score: r.elevated.score.badness,
      evidence: `${kind} "${label}" has ${names.join(", ")}, assigned to ${users}. ${r.elevated.score.explanation}`,
      measured: `${plural(names.length, "elevated permission")}: ${names.join(", ")}`,
      expected: "Only administrators and integration users should hold these",
      explanation: `${label} gives its users permissions that bypass or administer the security model. ${r.elevated.score.explanation}`,
      risk: "Users with these permissions can read or change data they were never explicitly granted, or alter who can.",
      impact: `Anyone assigned ${label} (${users}) inherits the access.`,
      remediation: "Remove the permissions that are not needed, or move them to a narrowly assigned set kept for administrators.",
      validation: "Run the Security check again; the permissions should no longer be listed for this set.",
      contributors: r.elevated.score.contributors,
    });
  }
  if (r.broad.breached) {
    out.push({
      ...base,
      ruleKey: "SecurityHealth.BroadObjectGrant",
      title: `${label} grants View All or Modify All on many objects`,
      severity: r.broad.score.severity,
      confidence: "high",
      score: r.broad.score.badness,
      evidence: `${kind} "${label}" grants Modify All on ${plural(r.broad.modifyAll, "object")} and View All on ${plural(r.broad.viewAll, "object")} (configured threshold: ${sec.broadObjectThreshold}). ${r.broad.score.explanation}`,
      measured: `${r.broad.modifyAll} Modify All, ${r.broad.viewAll} View All`,
      expected: `Fewer than ${sec.broadObjectThreshold} objects with View All / Modify All`,
      explanation: `View All and Modify All ignore sharing and record ownership. ${label} grants them on ${plural(r.broad.modifyAll + r.broad.viewAll, "object")}.`,
      risk: "Object-wide access defeats record-level sharing for every record of those objects.",
      impact: `${users} can see or change every record of those objects regardless of sharing.`,
      remediation: "Replace View All / Modify All with ordinary Read / Edit plus sharing rules, keeping the broad grant for the few roles that need it.",
      validation: "Run the Security check again; the object count should fall below the threshold.",
      contributors: r.broad.score.contributors,
    });
  }
  if (r.sensitive.breached) {
    out.push({
      ...base,
      ruleKey: "SecurityHealth.SensitiveObjectGrant",
      title: `${label} grants wide access to sensitive objects`,
      severity: r.sensitive.score.severity,
      confidence: "medium",
      score: r.sensitive.score.badness,
      evidence: `${kind} "${label}" grants View All, Modify All or Delete on ${r.sensitive.objects.join(", ")}. ${r.sensitive.score.explanation}`,
      measured: `Wide access to ${r.sensitive.objects.join(", ")}`,
      expected: "Wide access to sensitive objects limited to a few roles",
      explanation: `${label} gives wide access to objects this org treats as sensitive (${r.sensitive.objects.join(", ")}). Which objects count as sensitive is configurable.`,
      risk: "Personal or case data could be read, changed or deleted in bulk by users who only need a few records.",
      impact: `${users} hold${r.users === 1 ? "s" : ""} this access.`,
      remediation: "Narrow the grant to Read/Edit and rely on sharing, or move it to a set assigned only to the roles that need it.",
      validation: "Run the Security check again; the sensitive objects should no longer be listed for this set.",
      contributors: r.sensitive.score.contributors,
    });
  }
  return out;
}
