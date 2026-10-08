import { describe, expect, it } from "vitest";
import { HealthInputError } from "../errors";
import type { FindingRow } from "./findingTypes";
import { EXPORT_LIMIT, csvCell, exportCsv, parseRemediationQuery, remediationPage, summarize } from "./remediation";

const NOW = new Date("2026-10-08T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

let seq = 0;
const row = (over: Partial<FindingRow> = {}): FindingRow => {
  seq += 1;
  return {
    id: `id-${String(seq).padStart(4, "0")}`,
    section: "code",
    ruleKey: "CodeHealth.HighDependency",
    componentKey: `k${seq}`,
    componentType: "Apex Class",
    componentLabel: `Class${seq}`,
    title: `Title ${seq}`,
    severity: "warning",
    confidence: "medium",
    score: 50,
    status: "open",
    measured: "30",
    expected: "< 20",
    owner: null,
    dueDate: null,
    riskAcceptanceExpiry: null,
    firstDetectedAt: day(-10),
    lastDetectedAt: day(-1),
    resolvedAt: null,
    ...over,
  };
};
const q = (raw: Record<string, unknown> = {}) => parseRemediationQuery(raw);
const ids = (rows: FindingRow[], raw: Record<string, unknown> = {}) => remediationPage(rows, q(raw), NOW).rows.map((r) => r.id);

describe("parseRemediationQuery", () => {
  it("defaults to severity, most severe first, 25 per page", () => {
    expect(q()).toMatchObject({ sort: "severity", direction: "desc", limit: 25, offset: 0 });
  });

  it("parses lists and flags", () => {
    expect(q({ sections: "code,data", statuses: "open,in_progress", severities: "critical", overdue: "true", expiringRisk: "false" })).toMatchObject({
      sections: ["code", "data"],
      statuses: ["open", "in_progress"],
      severities: ["critical"],
      overdue: true,
      expiringRisk: false,
    });
  });

  it.each([
    [{ sections: "nope" }],
    [{ statuses: "open,bogus" }],
    [{ severities: "severe" }],
    [{ sort: "owner" }],
    [{ direction: "up" }],
    [{ limit: "0" }],
    [{ limit: "101" }],
    [{ limit: "abc" }],
    [{ offset: "2001" }],
    [{ overdue: "yes" }],
    [{ search: ["a", "b"] }],
  ])("rejects %j", (raw) => {
    expect(() => q(raw)).toThrow(HealthInputError);
  });
});

describe("remediationPage", () => {
  it("sorts by severity then score, and pages", () => {
    const rows = [row({ severity: "warning", score: 60 }), row({ severity: "critical", score: 10 }), row({ severity: "warning", score: 80 }), row({ severity: "critical", score: 90 })];
    expect(ids(rows)).toEqual([rows[3].id, rows[1].id, rows[2].id, rows[0].id]);
    expect(ids(rows, { sort: "severity", direction: "asc" })[0]).toBe(rows[2].id);
    expect(ids(rows, { limit: "2", offset: "1" })).toEqual([rows[1].id, rows[2].id]);
    expect(remediationPage(rows, q({ limit: "2" }), NOW).total).toBe(4);
  });

  it("sorts by title, score and dates in both directions", () => {
    const rows = [row({ title: "B", score: 2, lastDetectedAt: day(-3) }), row({ title: "A", score: 3, lastDetectedAt: day(-1) }), row({ title: "C", score: 1, lastDetectedAt: day(-2) })];
    expect(ids(rows, { sort: "title" })).toEqual([rows[1].id, rows[0].id, rows[2].id]);
    expect(ids(rows, { sort: "title", direction: "desc" })).toEqual([rows[2].id, rows[0].id, rows[1].id]);
    expect(ids(rows, { sort: "score" })).toEqual([rows[1].id, rows[0].id, rows[2].id]);
    expect(ids(rows, { sort: "lastDetectedAt" })).toEqual([rows[1].id, rows[2].id, rows[0].id]);
  });

  it("puts findings with no due date last, either way", () => {
    const rows = [row({ dueDate: null }), row({ dueDate: day(5) }), row({ dueDate: day(2) })];
    expect(ids(rows, { sort: "dueDate" })).toEqual([rows[2].id, rows[1].id, rows[0].id]);
    expect(ids(rows, { sort: "dueDate", direction: "desc" })).toEqual([rows[1].id, rows[2].id, rows[0].id]);
  });

  it("sorts by status in lifecycle order", () => {
    const rows = [row({ status: "resolved" }), row({ status: "open" }), row({ status: "in_progress" })];
    expect(ids(rows, { sort: "status" })).toEqual([rows[1].id, rows[2].id, rows[0].id]);
  });

  it("filters by section, severity, status and owner, including unassigned", () => {
    const rows = [row({ section: "data", owner: "Sam" }), row({ section: "code", severity: "critical" }), row({ status: "resolved", owner: "sam" })];
    expect(ids(rows, { sections: "data" })).toEqual([rows[0].id]);
    expect(ids(rows, { severities: "critical" })).toEqual([rows[1].id]);
    expect(ids(rows, { statuses: "resolved" })).toEqual([rows[2].id]);
    expect(ids(rows, { owner: "SAM" }).sort()).toEqual([rows[0].id, rows[2].id].sort());
    expect(ids(rows, { owner: "unassigned" })).toEqual([rows[1].id]);
  });

  it("searches title, component, rule and owner case-insensitively", () => {
    const rows = [row({ title: "Too many fields" }), row({ componentLabel: "BillingService" }), row({ owner: "Priya" }), row()];
    expect(ids(rows, { search: "FIELDS" })).toEqual([rows[0].id]);
    expect(ids(rows, { search: "billing" })).toEqual([rows[1].id]);
    expect(ids(rows, { search: "priya" })).toEqual([rows[2].id]);
    expect(ids(rows, { search: "CodeHealth" })).toHaveLength(4);
  });

  it("finds overdue findings, but not accepted or closed ones", () => {
    const rows = [row({ dueDate: day(-2) }), row({ dueDate: day(2) }), row({ dueDate: day(-2), status: "risk_accepted" }), row({ dueDate: day(-2), status: "resolved" })];
    expect(ids(rows, { overdue: "true" })).toEqual([rows[0].id]);
    expect(remediationPage(rows, q({ overdue: "true" }), NOW).rows[0].overdue).toBe(true);
  });

  it("finds accepted risks that expire within 30 days or already expired", () => {
    const rows = [
      row({ status: "risk_accepted", riskAcceptanceExpiry: day(10) }),
      row({ status: "risk_accepted", riskAcceptanceExpiry: day(90) }),
      row({ status: "risk_accepted", riskAcceptanceExpiry: day(-1) }),
      row({ status: "open", riskAcceptanceExpiry: day(5) }),
    ];
    expect(ids(rows, { expiringRisk: "true" }).sort()).toEqual([rows[0].id, rows[2].id].sort());
    const expired = remediationPage(rows, q({ statuses: "risk_accepted" }), NOW).rows.find((r) => r.id === rows[2].id)!;
    expect(expired.riskExpired).toBe(true);
  });

  it("returns an empty page past the end", () => {
    expect(remediationPage([row()], q({ offset: "50" }), NOW)).toMatchObject({ total: 1, rows: [] });
  });
});

describe("summarize", () => {
  it("counts by status, and active findings by severity, section and owner", () => {
    const rows = [
      row({ severity: "critical", section: "code" }),
      row({ severity: "warning", section: "data", owner: "Sam", status: "in_progress", dueDate: day(-1) }),
      row({ status: "resolved" }),
      row({ status: "risk_accepted", riskAcceptanceExpiry: day(5) }),
      row({ status: "risk_accepted", riskAcceptanceExpiry: day(-5) }),
      row({ status: "false_positive" }),
    ];
    const s = summarize(rows, NOW);
    expect(s).toMatchObject({ total: 6, active: 2, overdue: 1, unassigned: 1, riskExpiringSoon: 1, riskExpired: 1 });
    expect(s.byStatus).toMatchObject({ open: 1, in_progress: 1, resolved: 1, risk_accepted: 2, false_positive: 1, acknowledged: 0 });
    expect(s.activeBySeverity).toEqual({ critical: 1, warning: 1, good: 0 });
    expect(s.activeBySection).toMatchObject({ code: 1, data: 1, metadata: 0 });
  });

  it("is all zero for no findings", () => {
    expect(summarize([], NOW)).toMatchObject({ total: 0, active: 0, overdue: 0 });
  });
});

describe("csv export", () => {
  it("neutralises spreadsheet formulas and quotes special characters", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\t=x")).toBe("'\t=x");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(5)).toBe("5");
    expect(csvCell(new Date("2026-10-08T10:00:00Z"))).toBe("2026-10-08");
  });

  it("writes a header and one line per finding", () => {
    const { csv, total, truncated } = exportCsv([row({ title: "=bad", owner: "Sam" })], q(), NOW);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Section,Rule,Title");
    expect(lines[1]).toContain("'=bad");
    expect(lines[1]).toContain("Sam");
    expect({ total, truncated }).toEqual({ total: 1, truncated: false });
  });

  it("honours filters and caps the number of rows", () => {
    const many = Array.from({ length: EXPORT_LIMIT + 5 }, () => row());
    const out = exportCsv(many, q(), NOW);
    expect(out.csv.trimEnd().split("\r\n")).toHaveLength(EXPORT_LIMIT + 1);
    expect(out).toMatchObject({ total: EXPORT_LIMIT + 5, truncated: true });
    expect(exportCsv(many, q({ sections: "data" }), NOW).total).toBe(0);
  });
});
