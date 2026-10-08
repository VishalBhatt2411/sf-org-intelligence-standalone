import { api } from "../api/client";

// Wire shapes of the Org Health API (backend/src/health and backend/src/routes/health.ts). The UI only
// displays what comes back; scores, severities and findings are all decided on the server.

export type Severity = "good" | "warning" | "critical";
export const SECTION_KEYS = ["overview", "metadata", "automation", "code", "security", "data", "storage"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const FINDING_SECTIONS = ["metadata", "automation", "code", "security", "data"] as const;
export type FindingSection = (typeof FINDING_SECTIONS)[number];
export const FINDING_STATUSES = ["open", "acknowledged", "in_progress", "risk_accepted", "resolved", "false_positive"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export type MetricBasis = "scan" | "live" | "calculated";

export type Kpi = { key: string; label: string; value: string; basis: MetricBasis; drilldownKey?: string };
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
  facts: Array<{ label: string; value: string; detail?: string }>;
  unavailable: string[];
};

export type DrilldownResult = { title: string; caption: string; columns: string[]; rows: BreakdownRow[] };

export type SummaryCard = {
  section: SectionKey;
  label: string;
  scored: boolean;
  live: boolean;
  score: number | null;
  severity: Severity | null;
  computedAt: string | null;
  complete: boolean;
  note: string;
  topSignal: string | null;
};

export type RemediationSummary = {
  total: number;
  active: number;
  byStatus: Record<string, number>;
  activeBySeverity: Record<Severity, number>;
  activeBySection: Record<string, number>;
  overdue: number;
  unassigned: number;
  riskExpiringSoon: number;
  riskExpired: number;
};

export type HealthSummary = { cards: SummaryCard[]; findings: RemediationSummary };
export type TrendPoint = { at: string; score: number | null; severity: Severity | null };

export type FindingRow = {
  id: string;
  section: FindingSection;
  ruleKey: string;
  componentKey: string;
  componentType: string;
  componentLabel: string;
  title: string;
  severity: Severity;
  confidence: "low" | "medium" | "high";
  score: number;
  status: FindingStatus;
  measured: string;
  expected: string;
  owner: string | null;
  dueDate: string | null;
  riskAcceptanceExpiry: string | null;
  firstDetectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
  overdue: boolean;
  riskExpired: boolean;
};

export type RemediationPage = { total: number; limit: number; offset: number; rows: FindingRow[] };

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

export type FindingDetail = FindingRow & {
  connectionId: string;
  ruleVersion: number;
  evidence: string;
  explanation: string;
  risk: string;
  impact: string;
  remediation: string;
  validation: string;
  contributors: Contributor[];
  notes: string | null;
  compensatingControl: string | null;
  falsePositiveReason: string | null;
};

export type FindingEvent = { id: string; findingId: string; field: string; oldValue: string | null; newValue: string | null; changedBy: string; changedAt: string };

// Fields a person may change; dates are YYYY-MM-DD or null, text is null to clear.
export type TriagePatch = Partial<{
  status: FindingStatus;
  owner: string | null;
  dueDate: string | null;
  notes: string | null;
  compensatingControl: string | null;
  riskAcceptanceExpiry: string | null;
  falsePositiveReason: string | null;
}>;

export type RunStatus = "running" | "succeeded" | "failed";
export type HealthRun = { id: string; section: SectionKey; status: RunStatus; message: string | null; startedAt: string; finishedAt: string | null };

export type SyncReport = { section: SectionKey; result: SectionResult; findings: { created: number; refreshed: number; reopened: number; resolved: number } | null };

export type SeverityBand = { severity: Severity; label: string; range: string; meaning: string };
export type RegistryRule = { ruleKey: string; section: FindingSection; title: string; threshold: string };
export type SeverityRegistry = { bands: SeverityBand[]; rules: RegistryRule[] };

export type NavigateTarget = { nodeKey: string; typeKey: string; label: string; fqn: string };

export type RemediationFilters = {
  sections?: FindingSection[];
  severities?: Severity[];
  statuses?: FindingStatus[];
  owner?: string;
  search?: string;
  overdue?: boolean;
  expiringRisk?: boolean;
  sort: string;
  direction: "asc" | "desc";
  limit: number;
  offset: number;
};

export function healthApi(connectionId: string) {
  const base = `/connections/${encodeURIComponent(connectionId)}/health`;
  const finding = (id: string) => `${base}/findings/${encodeURIComponent(id)}`;
  return {
    key: connectionId,
    summary: () => api.get<HealthSummary>(`${base}/summary`).then((r) => r.data),
    section: (section: SectionKey) => api.get<SectionResult>(`${base}/${section}`).then((r) => r.data),
    drilldown: (section: SectionKey, metricKey: string) => api.get<DrilldownResult>(`${base}/${section}/drilldown`, { params: { metricKey } }).then((r) => r.data),
    trend: (section: SectionKey) => api.get<{ points: TrendPoint[] }>(`${base}/trend`, { params: { section } }).then((r) => r.data.points),
    registry: () => api.get<SeverityRegistry>(`${base}/severity-registry`).then((r) => r.data),
    sync: (section: SectionKey) => api.post<SyncReport>(`${base}/sync/${section}`).then((r) => r.data),
    dataRun: () => api.get<{ run: HealthRun | null }>(`${base}/data/run`).then((r) => r.data.run),
    startDataRun: () => api.post<{ run: HealthRun; started: boolean }>(`${base}/data/run`).then((r) => r.data),
    findings: (params: Record<string, string>) => api.get<RemediationPage>(`${base}/findings`, { params }).then((r) => r.data),
    remediation: (params: Record<string, string>) => api.get<RemediationPage>(`${base}/remediation`, { params }).then((r) => r.data),
    remediationSummary: () => api.get<RemediationSummary>(`${base}/remediation/summary`).then((r) => r.data),
    exportCsv: (params: Record<string, string>) => api.get<Blob>(`${base}/remediation/export`, { params, responseType: "blob" }),
    finding: (id: string) => api.get<FindingDetail>(finding(id)).then((r) => r.data),
    related: (id: string) => api.get<{ findings: FindingRow[] }>(`${finding(id)}/related`).then((r) => r.data.findings),
    history: (id: string) => api.get<{ events: FindingEvent[] }>(`${finding(id)}/history`).then((r) => r.data.events),
    navigate: (id: string) => api.get<NavigateTarget>(`${finding(id)}/navigate`).then((r) => r.data),
    triage: (id: string, patch: TriagePatch) => api.patch<FindingDetail>(finding(id), patch).then((r) => r.data),
  };
}

export type HealthApi = ReturnType<typeof healthApi>;
