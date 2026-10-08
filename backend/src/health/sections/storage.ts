import type { SectionResult } from "../types";
import { errorText, liveKpi, type LiveSectionContext } from "./shared";

// Storage (unscored, live): data and file storage used, from the REST /limits resource. Used = Max - Remaining.
// A value the response does not carry is listed as unavailable, never shown as zero.

const LIMITS = [
  { key: "DataStorageMB", label: "Data storage" },
  { key: "FileStorageMB", label: "File storage" },
] as const;

const mb = (n: number): string => (n >= 1024 ? `${Math.round((n / 1024) * 10) / 10} GB` : `${Math.round(n)} MB`);
const percent = (used: number, max: number): number => (max > 0 ? Math.round((used / max) * 1000) / 10 : 0);

export async function computeStorage(ctx: LiveSectionContext): Promise<SectionResult> {
  const { source, now } = ctx;
  const result: SectionResult = {
    section: "storage",
    label: "Storage",
    scored: false,
    score: null,
    severity: null,
    basis: "live",
    computedAt: now.toISOString(),
    coverage: { complete: true, note: "Read from the Salesforce limits resource just now" },
    kpis: [],
    formula: null,
    breakdown: { title: "", caption: "", columns: [], rows: [] },
    heatmap: { columns: [], rows: [] },
    facts: [],
    unavailable: [],
  };

  let limits: Awaited<ReturnType<typeof source.limits>>;
  try {
    limits = await source.limits();
  } catch (err) {
    console.warn("org health: storage limits read failed:", errorText(err));
    result.unavailable.push("Storage limits could not be read");
    result.coverage = { complete: false, note: "Storage limits could not be read." };
    return result;
  }

  for (const { key, label } of LIMITS) {
    const v = limits[key];
    if (!v) {
      result.unavailable.push(`${label} was not in the limits response`);
      continue;
    }
    const used = Math.max(0, v.max - v.remaining);
    const pct = percent(used, v.max);
    result.kpis.push(liveKpi(key, `${label} used`, `${pct}%`));
    result.facts.push({ label, value: `${mb(used)} of ${mb(v.max)} (${pct}%)`, detail: pct < 80 ? "Plenty of room" : pct < 95 ? "Getting full" : "Nearly full" });
  }
  if (result.unavailable.length > 0) result.coverage = { complete: false, note: "Some storage values were not returned." };
  return result;
}
