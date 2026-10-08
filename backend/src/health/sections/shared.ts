import { edgeTypeKey } from "../../graph/nodeTypes";
import type { HealthConfig } from "../config";
import type { HealthGraphRepository } from "../healthGraphRepository";
import type { HealthSource } from "../healthSource";
import { severityRank, type BreakdownRow, type Cell, type Kpi, type SectionKey, type SectionResult, type Severity } from "../types";

// Small helpers the scan-derived sections (Metadata, Automation, Code) share.

export type SectionContext = { graph: HealthGraphRepository; connectionId: string; config: HealthConfig; now: Date };

// What the live sections (Security, Data, Storage) need: a way to read Salesforce, not the graph.
export type LiveSectionContext = { source: HealthSource; connectionId: string; config: HealthConfig; now: Date };

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// A live kpi: same as kpi() but read from Salesforce just now.
export const liveKpi = (key: string, label: string, value: string | number): Kpi => ({ key, label, value: String(value), basis: "live" });

// Edges that mean "this component depends on that one"; REFERENCES is heuristic, DEPENDS_ON exact.
export const DEPENDENCY_EDGES = [edgeTypeKey("REFERENCES"), edgeTypeKey("DEPENDS_ON")];

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
export const SEVERITY_NAME: Record<Severity, string> = { good: "Good", warning: "Warning", critical: "Critical" };

// Coverage note shown under a section: how much of the org the numbers describe.
export function coverageNote(scanned: number, noun: string, ceilingReached: boolean): { complete: boolean; note: string } {
  return ceilingReached
    ? { complete: false, note: `${scanned} ${noun} scanned (ceiling reached — results may be incomplete)` }
    : { complete: true, note: `${scanned} / ${scanned} ${noun} scanned` };
}

export const kpi = (key: string, label: string, value: string | number, drilldownKey?: string): Kpi => ({ key, label, value: String(value), basis: "scan", ...(drilldownKey ? { drilldownKey } : {}) });

// The section a user sees before the first scan has produced any graph data.
export function noGraphData(section: SectionKey, label: string, scored: boolean, now: Date, noun: string): SectionResult {
  return {
    section,
    label,
    scored,
    score: null,
    severity: null,
    basis: "scan",
    computedAt: now.toISOString(),
    coverage: { complete: false, note: `No ${noun} in the graph yet — run a scan to populate it.` },
    kpis: [],
    formula: null,
    breakdown: { title: "", caption: "", columns: [], rows: [] },
    heatmap: { columns: [], rows: [] },
    facts: [],
    unavailable: [],
  };
}

export const worstRowFirst = <T extends { severity: Severity }>(a: T, b: T): number => severityRank(a.severity) - severityRank(b.severity);

export const topCaption = (shown: number, total: number): string => (shown >= total ? plural(total, "item") : `Top ${shown} of ${total}`);

export function heatmapRows(rows: BreakdownRow[], columns: string[], limit: number): Array<{ label: string; cells: Cell[] }> {
  return rows.slice(0, limit).map((r) => ({
    label: r.label,
    cells: columns.map((column) => ({ column, value: r.metrics.find((m) => m.column === column)?.value ?? "", severity: r.severity })),
  }));
}

export type DrilldownResult = { title: string; caption: string; columns: string[]; rows: BreakdownRow[] };

export const DRILLDOWN_LIMIT = 500;
