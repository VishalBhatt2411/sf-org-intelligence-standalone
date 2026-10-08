import { describe, expect, it } from "vitest";
import type { FindingDetail, SectionResult } from "./healthApi";
import {
  ACTIVE_STATUSES,
  DEFAULT_FILTERS,
  hasChanges,
  isNotRun,
  pageRange,
  relativeTime,
  remediationParams,
  scoreText,
  severityColor,
  severityLabel,
  stateBanner,
  trendDelta,
  triagePatch,
  formFromFinding,
} from "./healthFormat";

const section = (over: Partial<SectionResult> = {}): SectionResult => ({
  section: "code",
  label: "Code",
  scored: true,
  score: 80,
  severity: "good",
  basis: "scan",
  computedAt: "2026-10-01T10:00:00.000Z",
  coverage: { complete: true, note: "" },
  kpis: [],
  formula: null,
  breakdown: { title: "", caption: "", columns: [], rows: [] },
  heatmap: { columns: [], rows: [] },
  facts: [],
  unavailable: [],
  ...over,
});

const finding = (over: Partial<FindingDetail> = {}): FindingDetail => ({
  id: "f1",
  connectionId: "c1",
  section: "code",
  ruleKey: "r",
  ruleVersion: 1,
  componentKey: "k",
  componentType: "ApexClass",
  componentLabel: "Hub",
  title: "t",
  severity: "warning",
  confidence: "high",
  score: 5,
  status: "open",
  measured: "",
  expected: "",
  owner: null,
  dueDate: null,
  riskAcceptanceExpiry: null,
  firstDetectedAt: "2026-09-01T00:00:00.000Z",
  lastDetectedAt: "2026-09-02T00:00:00.000Z",
  resolvedAt: null,
  overdue: false,
  riskExpired: false,
  evidence: "",
  explanation: "",
  risk: "",
  impact: "",
  remediation: "",
  validation: "",
  contributors: [],
  notes: null,
  compensatingControl: null,
  falsePositiveReason: null,
  ...over,
});

describe("labels and scores", () => {
  it("names severities, with Not scored for none", () => {
    expect(severityLabel("critical")).toBe("Critical");
    expect(severityLabel(null)).toBe("Not scored");
  });
  it("picks the colour for the theme", () => {
    expect(severityColor("good", false)).toBe("#2e844a");
    expect(severityColor("good", true)).toBe("#45c65a");
  });
  it("shows whole scores as integers, others to one decimal, null as a dash", () => {
    expect(scoreText(72)).toBe("72");
    expect(scoreText(72.46)).toBe("72.5");
    expect(scoreText(null)).toBe("—");
  });
  it("describes elapsed time", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    expect(relativeTime(null, now)).toBe("never");
    expect(relativeTime("1970-01-01T00:00:00.000Z", now)).toBe("never");
    expect(relativeTime("2026-10-08T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-10-08T11:15:00Z", now)).toBe("45 min ago");
    expect(relativeTime("2026-10-08T07:00:00Z", now)).toBe("5 h ago");
    expect(relativeTime("2026-10-05T12:00:00Z", now)).toBe("3 d ago");
  });
  it("reports page ranges", () => {
    expect(pageRange(0, 25, 0)).toBe("0 findings");
    expect(pageRange(60, 25, 50)).toBe("51–60 of 60");
  });
  it("computes the change since the previous point", () => {
    expect(trendDelta([{ score: 70 }])).toBeNull();
    expect(trendDelta([{ score: 70 }, { score: null }, { score: 75.5 }])).toBe(5.5);
  });
});

describe("state banner", () => {
  it("treats the epoch shell as not run", () => {
    const shell = section({ computedAt: "1970-01-01T00:00:00.000Z", coverage: { complete: false, note: "Not run yet — run the check." } });
    expect(isNotRun(shell)).toBe(true);
    expect(stateBanner(shell)).toEqual({ kind: "info", message: "Not run yet — run the check.", details: [] });
  });
  it("warns about incomplete coverage and unreadable parts", () => {
    expect(stateBanner(section({ coverage: { complete: false, note: "Partial scan" } }))?.kind).toBe("warning");
    expect(stateBanner(section({ unavailable: ["ObjectPermissions"] }))?.details).toEqual(["ObjectPermissions"]);
  });
  it("shows nothing for a complete result", () => {
    expect(stateBanner(section())).toBeNull();
  });
});

describe("remediation query", () => {
  it("opens on the active statuses", () => {
    expect(DEFAULT_FILTERS.statuses).toEqual(ACTIVE_STATUSES);
    expect(remediationParams(DEFAULT_FILTERS)).toEqual({ sort: "severity", direction: "desc", statuses: "open,acknowledged,in_progress", limit: "25", offset: "0" });
  });
  it("sends only the filters that are set", () => {
    const params = remediationParams({ ...DEFAULT_FILTERS, statuses: [], sections: ["code", "data"], severities: ["critical"], owner: " Sam ", search: "", overdue: true });
    expect(params).toMatchObject({ sections: "code,data", severities: "critical", owner: "Sam", overdue: "true" });
    expect(params).not.toHaveProperty("statuses");
    expect(params).not.toHaveProperty("search");
    expect(params).not.toHaveProperty("expiringRisk");
  });
  it("leaves paging out of an export", () => {
    const params = remediationParams(DEFAULT_FILTERS, { paged: false });
    expect(params).not.toHaveProperty("limit");
    expect(params).not.toHaveProperty("offset");
  });
});

describe("triage patch", () => {
  const now = new Date("2026-10-08T00:00:00Z");

  it("sends nothing when nothing changed", () => {
    const f = finding({ owner: "Sam", dueDate: "2026-11-01T00:00:00.000Z" });
    expect(triagePatch(f, formFromFinding(f), now)).toEqual({ patch: {}, error: null });
  });
  it("sends only the changed fields, clearing text with null", () => {
    const f = finding({ owner: "Sam", notes: "old" });
    const form = { ...formFromFinding(f), status: "in_progress" as const, notes: "  ", dueDate: "2026-12-01" };
    const { patch, error } = triagePatch(f, form, now);
    expect(error).toBeNull();
    expect(patch).toEqual({ status: "in_progress", notes: null, dueDate: "2026-12-01" });
    expect(hasChanges(patch)).toBe(true);
  });
  it("requires a reason for a false positive", () => {
    const f = finding();
    expect(triagePatch(f, { ...formFromFinding(f), status: "false_positive" }, now).error).toMatch(/false positive/);
    const ok = triagePatch(f, { ...formFromFinding(f), status: "false_positive", falsePositiveReason: "Test class" }, now);
    expect(ok.error).toBeNull();
    expect(ok.patch).toEqual({ status: "false_positive", falsePositiveReason: "Test class" });
  });
  it("requires a new risk expiry to be in the future", () => {
    const f = finding();
    expect(triagePatch(f, { ...formFromFinding(f), riskAcceptanceExpiry: "2026-10-01" }, now).error).toMatch(/future/);
    expect(triagePatch(f, { ...formFromFinding(f), riskAcceptanceExpiry: "2027-01-01" }, now).patch).toEqual({ riskAcceptanceExpiry: "2027-01-01" });
  });
  it("does not re-check an unchanged expiry that has since passed", () => {
    const f = finding({ riskAcceptanceExpiry: "2026-09-01T00:00:00.000Z" });
    expect(triagePatch(f, formFromFinding(f), now).error).toBeNull();
  });
  it("rejects text over the limit", () => {
    const f = finding();
    expect(triagePatch(f, { ...formFromFinding(f), owner: "x".repeat(121) }, now).error).toMatch(/too long/);
  });
});
