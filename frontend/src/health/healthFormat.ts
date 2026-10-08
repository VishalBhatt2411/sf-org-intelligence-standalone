import type { FindingDetail, FindingSection, FindingStatus, RemediationFilters, SectionResult, Severity, TriagePatch } from "./healthApi";

// Pure display helpers for Org Health: labels, colours, query building and the triage form. No React here,
// so every rule is unit-testable.

// Fixed severity colours (light / dark). Colour is never the only signal: a badge always carries text.
export const SEVERITY_STYLE: Record<Severity, { label: string; light: string; dark: string }> = {
  good: { label: "Good", light: "#2e844a", dark: "#45c65a" },
  warning: { label: "Warning", light: "#b95000", dark: "#f0a020" },
  critical: { label: "Critical", light: "#ba0517", dark: "#fe8aa7" },
};

export const severityColor = (severity: Severity, dark: boolean): string => SEVERITY_STYLE[severity][dark ? "dark" : "light"];
export const severityLabel = (severity: Severity | null): string => (severity ? SEVERITY_STYLE[severity].label : "Not scored");

export const STATUS_LABEL: Record<FindingStatus, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  risk_accepted: "Risk accepted",
  resolved: "Resolved",
  false_positive: "False positive",
};

export const SECTION_LABEL: Record<FindingSection, string> = {
  metadata: "Metadata",
  automation: "Automation",
  code: "Code",
  security: "Security",
  data: "Data",
};

// Statuses where somebody still has to act; the queue opens on these.
export const ACTIVE_STATUSES: FindingStatus[] = ["open", "acknowledged", "in_progress"];

export function scoreText(score: number | null): string {
  if (score === null) return "—";
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function relativeTime(value: string | null, now: Date = new Date()): string {
  if (!value) return "never";
  const then = new Date(value).getTime();
  if (Number.isNaN(then) || then <= 0) return "never";
  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

// A live section nobody has run yet comes back as a shell stamped with the epoch.
export const isNotRun = (result: Pick<SectionResult, "computedAt">): boolean => !(Date.parse(result.computedAt) > 0);

export type Banner = { kind: "info" | "warning"; message: string; details: string[] };

// The one notice shown above a section: not run, incomplete, or partly unreadable.
export function stateBanner(result: SectionResult): Banner | null {
  if (isNotRun(result)) return { kind: "info", message: result.coverage.note || "Not run yet.", details: [] };
  if (!result.coverage.complete || result.unavailable.length > 0) {
    return { kind: "warning", message: result.coverage.note || "This result is incomplete.", details: result.unavailable };
  }
  return null;
}

const dayOnly = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");

export type TriageForm = {
  status: FindingStatus;
  owner: string;
  dueDate: string;
  notes: string;
  compensatingControl: string;
  riskAcceptanceExpiry: string;
  falsePositiveReason: string;
};

export const TEXT_LIMITS = { owner: 120, notes: 4000, compensatingControl: 2000, falsePositiveReason: 2000 } as const;

export function formFromFinding(f: FindingDetail): TriageForm {
  return {
    status: f.status,
    owner: f.owner ?? "",
    dueDate: dayOnly(f.dueDate),
    notes: f.notes ?? "",
    compensatingControl: f.compensatingControl ?? "",
    riskAcceptanceExpiry: dayOnly(f.riskAcceptanceExpiry),
    falsePositiveReason: f.falsePositiveReason ?? "",
  };
}

const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());

// Only what changed is sent, so a save never overwrites someone else's edit to another field. The same
// rules are enforced again on the server; checking here just gives the answer before the round trip.
export function triagePatch(original: FindingDetail, form: TriageForm, today: Date = new Date()): { patch: TriagePatch; error: string | null } {
  const patch: TriagePatch = {};
  const was = formFromFinding(original);
  if (form.status !== was.status) patch.status = form.status;
  for (const field of ["owner", "notes", "compensatingControl", "falsePositiveReason"] as const) {
    if (form[field].trim() !== was[field].trim()) patch[field] = orNull(form[field]);
    if (form[field].length > TEXT_LIMITS[field]) return { patch: {}, error: `${field} is too long (limit ${TEXT_LIMITS[field]})` };
  }
  if (form.dueDate !== was.dueDate) patch.dueDate = orNull(form.dueDate);
  if (form.riskAcceptanceExpiry !== was.riskAcceptanceExpiry) {
    patch.riskAcceptanceExpiry = orNull(form.riskAcceptanceExpiry);
    if (patch.riskAcceptanceExpiry && new Date(patch.riskAcceptanceExpiry).getTime() <= today.getTime()) {
      return { patch: {}, error: "The risk acceptance must expire in the future" };
    }
  }
  if (form.status === "false_positive" && !orNull(form.falsePositiveReason)) {
    return { patch: {}, error: "Say why this is a false positive" };
  }
  return { patch, error: null };
}

export const hasChanges = (patch: TriagePatch): boolean => Object.keys(patch).length > 0;

export const DEFAULT_FILTERS: RemediationFilters = { statuses: ACTIVE_STATUSES, sort: "severity", direction: "desc", limit: 25, offset: 0 };

// Query parameters for /remediation and its export; empty filters are left out.
export function remediationParams(f: RemediationFilters, options: { paged?: boolean } = {}): Record<string, string> {
  const params: Record<string, string> = { sort: f.sort, direction: f.direction };
  if (f.sections?.length) params.sections = f.sections.join(",");
  if (f.severities?.length) params.severities = f.severities.join(",");
  if (f.statuses?.length) params.statuses = f.statuses.join(",");
  if (f.owner?.trim()) params.owner = f.owner.trim();
  if (f.search?.trim()) params.search = f.search.trim();
  if (f.overdue) params.overdue = "true";
  if (f.expiringRisk) params.expiringRisk = "true";
  if (options.paged !== false) {
    params.limit = String(f.limit);
    params.offset = String(f.offset);
  }
  return params;
}

export function pageRange(total: number, limit: number, offset: number): string {
  if (total === 0) return "0 findings";
  return `${offset + 1}–${Math.min(total, offset + limit)} of ${total}`;
}

// One line under a score: what changed since the previous point of the trend.
export function trendDelta(points: Array<{ score: number | null }>): number | null {
  const scores = points.map((p) => p.score).filter((s): s is number => s !== null);
  if (scores.length < 2) return null;
  return Math.round((scores[scores.length - 1] - scores[scores.length - 2]) * 10) / 10;
}
