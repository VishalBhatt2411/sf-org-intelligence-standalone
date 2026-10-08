import { HealthInputError } from "../errors";
import { FINDING_SECTIONS, FINDING_STATUSES, isFindingSection, isFindingStatus, severityRank, type FindingSection, type FindingStatus, type Severity } from "../types";
import { isOverdue, isRiskAcceptanceExpired, type FindingRow } from "./findingTypes";

// The remediation queue: every finding of a connection, filtered, sorted and paged. Rows are loaded lean
// (no long text) and handled in memory; a connection holds findings in the hundreds to low thousands, and the
// page and export caps keep what is sent small.

export const PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_OFFSET = 2000;
export const EXPORT_LIMIT = 2000;
const EXPIRING_DAYS = 30;
const DAY_MS = 86_400_000;

export const SORT_KEYS = ["severity", "status", "score", "title", "firstDetectedAt", "lastDetectedAt", "dueDate"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export type RemediationQuery = {
  sections?: FindingSection[];
  severities?: Severity[];
  statuses?: FindingStatus[];
  // Case-insensitive owner name, or "unassigned".
  owner?: string;
  search?: string;
  // Accepted risks that have expired or expire within 30 days.
  expiringRisk?: boolean;
  overdue?: boolean;
  sort: SortKey;
  direction: "asc" | "desc";
  limit: number;
  offset: number;
};

export type RemediationRow = FindingRow & { overdue: boolean; riskExpired: boolean };
export type RemediationPage = { total: number; limit: number; offset: number; rows: RemediationRow[] };

const DEFAULT_DIRECTION: Record<SortKey, "asc" | "desc"> = { severity: "desc", score: "desc", firstDetectedAt: "desc", lastDetectedAt: "desc", status: "asc", title: "asc", dueDate: "asc" };
const STATUS_RANK = new Map<string, number>(FINDING_STATUSES.map((s, i) => [s, i]));

function list(name: string, raw: unknown, valid: (v: string) => boolean): string[] | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string") throw new HealthInputError(`${name} must be a comma-separated list`);
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = items.find((i) => !valid(i));
  if (bad) throw new HealthInputError(`${name} has an unknown value: ${bad}`);
  return items;
}

function flag(name: string, raw: unknown): boolean | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new HealthInputError(`${name} must be true or false`);
}

function whole(name: string, raw: unknown, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === "") return fallback;
  if (typeof raw !== "string" || !/^\d{1,6}$/.test(raw)) throw new HealthInputError(`${name} must be a whole number`);
  const n = Number(raw);
  if (n < min || n > max) throw new HealthInputError(`${name} must be between ${min} and ${max}`);
  return n;
}

export function parseRemediationQuery(raw: Record<string, unknown>, defaults: { limit?: number } = {}): RemediationQuery {
  const sortRaw = raw.sort ?? "severity";
  if (typeof sortRaw !== "string" || !(SORT_KEYS as readonly string[]).includes(sortRaw)) throw new HealthInputError(`sort must be one of: ${SORT_KEYS.join(", ")}`);
  const sort = sortRaw as SortKey;
  const directionRaw = raw.direction ?? DEFAULT_DIRECTION[sort];
  if (directionRaw !== "asc" && directionRaw !== "desc") throw new HealthInputError("direction must be asc or desc");
  const owner = raw.owner;
  const search = raw.search;
  if ((owner !== undefined && typeof owner !== "string") || (search !== undefined && typeof search !== "string")) throw new HealthInputError("owner and search must be single values");
  return {
    sections: list("sections", raw.sections, isFindingSection) as FindingSection[] | undefined,
    severities: list("severities", raw.severities, (v) => v === "good" || v === "warning" || v === "critical") as Severity[] | undefined,
    statuses: list("statuses", raw.statuses, isFindingStatus) as FindingStatus[] | undefined,
    owner: owner?.trim() || undefined,
    search: search?.trim().slice(0, 200) || undefined,
    expiringRisk: flag("expiringRisk", raw.expiringRisk),
    overdue: flag("overdue", raw.overdue),
    sort,
    direction: directionRaw,
    limit: whole("limit", raw.limit, defaults.limit ?? PAGE_SIZE, 1, defaults.limit ? Math.max(defaults.limit, MAX_PAGE_SIZE) : MAX_PAGE_SIZE),
    offset: whole("offset", raw.offset, 0, 0, MAX_OFFSET),
  };
}

export function filterRows(rows: FindingRow[], q: RemediationQuery, now: Date): RemediationRow[] {
  const needle = q.search?.toLowerCase();
  const owner = q.owner?.toLowerCase();
  const soon = now.getTime() + EXPIRING_DAYS * DAY_MS;
  return rows
    .filter((r) => !q.sections || q.sections.includes(r.section))
    .filter((r) => !q.severities || q.severities.includes(r.severity))
    .filter((r) => !q.statuses || q.statuses.includes(r.status))
    .filter((r) => !owner || (owner === "unassigned" ? r.owner === null : r.owner?.toLowerCase() === owner))
    .filter((r) => !needle || [r.title, r.componentLabel, r.ruleKey, r.owner ?? ""].some((t) => t.toLowerCase().includes(needle)))
    .filter((r) => q.expiringRisk === undefined || (r.status === "risk_accepted" && r.riskAcceptanceExpiry !== null && r.riskAcceptanceExpiry.getTime() <= soon) === q.expiringRisk)
    .map((r) => ({ ...r, overdue: isOverdue(r, now), riskExpired: isRiskAcceptanceExpired(r, now) }))
    .filter((r) => q.overdue === undefined || r.overdue === q.overdue);
}

const time = (d: Date | null) => (d ? d.getTime() : null);

function compareBy(sort: SortKey, a: RemediationRow, b: RemediationRow): number {
  switch (sort) {
    case "severity":
      // severityRank is 0 for critical; ascending order here means "most severe first".
      return severityRank(a.severity) - severityRank(b.severity);
    case "status":
      return (STATUS_RANK.get(a.status) ?? 99) - (STATUS_RANK.get(b.status) ?? 99);
    case "score":
      return a.score - b.score;
    case "title":
      return a.title.localeCompare(b.title);
    case "firstDetectedAt":
    case "lastDetectedAt":
      return a[sort].getTime() - b[sort].getTime();
    case "dueDate": {
      // Findings without a due date always sort last, in either direction.
      const x = time(a.dueDate);
      const y = time(b.dueDate);
      return x === y ? 0 : x === null ? 1 : y === null ? -1 : x - y;
    }
  }
}

export function sortRows(rows: RemediationRow[], q: Pick<RemediationQuery, "sort" | "direction">): RemediationRow[] {
  // compareBy runs ascending, except severity, whose natural order is most-severe-first (what "desc" means).
  const sign = (q.direction === "asc") === (q.sort === "severity") ? -1 : 1;
  return [...rows].sort((a, b) => {
    const base = compareBy(q.sort, a, b);
    // A finding with no due date sorts after the others whichever way the dates run.
    const primary = q.sort === "dueDate" && (a.dueDate === null || b.dueDate === null) ? base : base * sign;
    return primary || severityRank(a.severity) - severityRank(b.severity) || b.score - a.score || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
}

export function remediationPage(rows: FindingRow[], q: RemediationQuery, now: Date): RemediationPage {
  const sorted = sortRows(filterRows(rows, q, now), q);
  return { total: sorted.length, limit: q.limit, offset: q.offset, rows: sorted.slice(q.offset, q.offset + q.limit) };
}

export type RemediationSummary = {
  total: number;
  // Findings still needing attention (open, acknowledged, in progress).
  active: number;
  byStatus: Record<string, number>;
  activeBySeverity: Record<Severity, number>;
  activeBySection: Record<string, number>;
  overdue: number;
  unassigned: number;
  riskExpiringSoon: number;
  riskExpired: number;
};

const ACTIVE: readonly FindingStatus[] = ["open", "acknowledged", "in_progress"];

export function summarize(rows: FindingRow[], now: Date): RemediationSummary {
  const soon = now.getTime() + EXPIRING_DAYS * DAY_MS;
  const out: RemediationSummary = {
    total: rows.length,
    active: 0,
    byStatus: Object.fromEntries(FINDING_STATUSES.map((s) => [s, 0])),
    activeBySeverity: { critical: 0, warning: 0, good: 0 },
    activeBySection: Object.fromEntries(FINDING_SECTIONS.map((s) => [s, 0])),
    overdue: 0,
    unassigned: 0,
    riskExpiringSoon: 0,
    riskExpired: 0,
  };
  for (const r of rows) {
    out.byStatus[r.status] += 1;
    if (isOverdue(r, now)) out.overdue += 1;
    if (r.status === "risk_accepted" && r.riskAcceptanceExpiry) {
      if (isRiskAcceptanceExpired(r, now)) out.riskExpired += 1;
      else if (r.riskAcceptanceExpiry.getTime() <= soon) out.riskExpiringSoon += 1;
    }
    if (!ACTIVE.includes(r.status)) continue;
    out.active += 1;
    out.activeBySeverity[r.severity] += 1;
    out.activeBySection[r.section] += 1;
    if (r.owner === null) out.unassigned += 1;
  }
  return out;
}

// A cell that starts with = + - @ (or a control character) would be run as a formula by a spreadsheet; the
// leading quote makes it plain text. Quoting follows RFC 4180.
export function csvCell(value: string | number | Date | null | undefined): string {
  let text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_COLUMNS: Array<[string, (r: RemediationRow) => string | number | Date | null]> = [
  ["Section", (r) => r.section],
  ["Rule", (r) => r.ruleKey],
  ["Title", (r) => r.title],
  ["Component", (r) => r.componentLabel],
  ["Component type", (r) => r.componentType],
  ["Severity", (r) => r.severity],
  ["Confidence", (r) => r.confidence],
  ["Score", (r) => r.score],
  ["Status", (r) => r.status],
  ["Measured", (r) => r.measured],
  ["Expected", (r) => r.expected],
  ["Owner", (r) => r.owner],
  ["Due date", (r) => r.dueDate],
  ["Risk acceptance expiry", (r) => r.riskAcceptanceExpiry],
  ["First detected", (r) => r.firstDetectedAt],
  ["Last detected", (r) => r.lastDetectedAt],
  ["Overdue", (r) => (r.overdue ? "yes" : "no")],
];

export function exportCsv(rows: FindingRow[], q: RemediationQuery, now: Date): { csv: string; total: number; truncated: boolean } {
  const sorted = sortRows(filterRows(rows, q, now), q);
  const shown = sorted.slice(0, EXPORT_LIMIT);
  const lines = [CSV_COLUMNS.map(([h]) => csvCell(h)).join(","), ...shown.map((r) => CSV_COLUMNS.map(([, get]) => csvCell(get(r))).join(","))];
  return { csv: `${lines.join("\r\n")}\r\n`, total: sorted.length, truncated: sorted.length > shown.length };
}
