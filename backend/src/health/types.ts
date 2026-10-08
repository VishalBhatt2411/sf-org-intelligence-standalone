// Shared vocabulary of the Org Health module: scoring inputs/outputs, the shape every section returns
// to the UI, and the finding candidates a section proposes for the triage workflow.

export type Severity = "good" | "warning" | "critical";

export const SECTION_KEYS = ["overview", "metadata", "automation", "code", "security", "data", "storage"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

// Sections that propose findings (the others are display-only).
export const FINDING_SECTIONS = ["metadata", "automation", "code", "security", "data"] as const;
export type FindingSection = (typeof FINDING_SECTIONS)[number];

export const isSectionKey = (v: unknown): v is SectionKey => typeof v === "string" && (SECTION_KEYS as readonly string[]).includes(v);
export const isFindingSection = (v: unknown): v is FindingSection => typeof v === "string" && (FINDING_SECTIONS as readonly string[]).includes(v);

// Where a number comes from, shown beside every metric so a reader knows how far to trust it.
export type MetricBasis = "scan" | "live" | "calculated";

export type Signal = {
  key: string;
  label: string;
  // Points this signal can add at most (before the multipliers).
  weight: number;
  // 1.0 = exactly at the threshold; capped at 1.5 when scoring.
  magnitude: number;
  confidence?: number;
  impactMultiplier?: number;
  exposureMultiplier?: number;
  hasCompensatingControl?: boolean;
  // Signals sharing a group describe the same underlying problem; only the largest counts.
  correlationGroup?: string;
  note?: string;
};

export type Contributor = {
  key: string;
  label: string;
  weight: number;
  magnitude: number;
  confidence: number;
  impactMultiplier: number;
  exposureMultiplier: number;
  hasCompensatingControl: boolean;
  wasCorrelatedOut: boolean;
  contribution: number;
  note: string;
};

export type ScoreResult = {
  // 0..100, higher = worse; one decimal.
  badness: number;
  // 100 - badness.
  health: number;
  severity: Severity;
  explanation: string;
  contributors: Contributor[];
};

export type Kpi = {
  key: string;
  label: string;
  value: string;
  basis: MetricBasis;
  // Present when the tile opens a drill-down list.
  drilldownKey?: string;
};

export type Cell = { column: string; value: string; severity: Severity | null };

export type BreakdownRow = {
  key: string;
  label: string;
  componentType: string;
  severity: Severity;
  metrics: Array<{ column: string; value: string }>;
  explanation: string;
};

export type SectionResult = {
  section: SectionKey;
  label: string;
  scored: boolean;
  score: number | null;
  severity: Severity | null;
  basis: MetricBasis;
  computedAt: string;
  coverage: { complete: boolean; note: string };
  kpis: Kpi[];
  formula: { summary: string; components: Array<{ label: string; weight: string }> } | null;
  breakdown: { title: string; caption: string; columns: string[]; rows: BreakdownRow[] };
  heatmap: { columns: string[]; rows: Array<{ label: string; cells: Cell[] }> };
  // Free-form facts for sections whose layout is not a ranked list (overview, storage).
  facts: Array<{ label: string; value: string; detail?: string }>;
  // Live sections only: anything the run could not read.
  unavailable: string[];
};

export const emptySection = (section: SectionKey, label: string, over: Partial<SectionResult> = {}): SectionResult => ({
  section,
  label,
  scored: false,
  score: null,
  severity: null,
  basis: "scan",
  computedAt: new Date(0).toISOString(),
  coverage: { complete: true, note: "" },
  kpis: [],
  formula: null,
  breakdown: { title: "", caption: "", columns: [], rows: [] },
  heatmap: { columns: [], rows: [] },
  facts: [],
  unavailable: [],
  ...over,
});

export type FindingConfidence = "low" | "medium" | "high";

// What a section proposes; the finding service turns these into stored findings.
export type FindingCandidate = {
  section: FindingSection;
  ruleKey: string;
  ruleVersion: number;
  componentKey: string;
  componentType: string;
  componentLabel: string;
  title: string;
  severity: Severity;
  confidence: FindingConfidence;
  score: number;
  evidence: string;
  measured: string;
  expected: string;
  explanation: string;
  risk: string;
  impact: string;
  remediation: string;
  validation: string;
  contributors: Contributor[];
};

// A section's complete output: what the UI shows, and what feeds the finding workflow.
export type SectionComputation = { result: SectionResult; candidates: FindingCandidate[] };

export const FINDING_STATUSES = ["open", "acknowledged", "in_progress", "risk_accepted", "resolved", "false_positive"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export const isFindingStatus = (v: unknown): v is FindingStatus => typeof v === "string" && (FINDING_STATUSES as readonly string[]).includes(v);

const RANK: Record<Severity, number> = { critical: 0, warning: 1, good: 2 };
export const severityRank = (s: Severity): number => RANK[s];
export const worstOf = (...all: Severity[]): Severity => all.reduce((a, b) => (RANK[b] < RANK[a] ? b : a), "good" as Severity);
