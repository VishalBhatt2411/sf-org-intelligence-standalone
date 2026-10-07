// Per-connection graph settings (stored in SalesforceConnection.graphSettings). Anything missing,
// malformed or out of range falls back to a safe default or is clamped, so a bad stored value can
// never turn into an unbounded traversal.

export type GraphSettings = {
  maxHopDepth: number;
  maxTraversalNodeCount: number;
  maxImpactDepth: number;
  maxImpactNodeCount: number;
  minSearchQueryLength: number;
  defaultSearchPageSize: number;
  maxSearchResults: number;
  repositoryPageSize: number;
  scanManagedPackageObjects: boolean;
  scanCustomizedStandardObjects: boolean;
  scanStandardPermissionSets: boolean;
};

type NumericKey = {
  [K in keyof GraphSettings]: GraphSettings[K] extends number ? K : never;
}[keyof GraphSettings];

// [default, min, max]. Max is a hard ceiling no stored setting can exceed.
const NUMERIC_BOUNDS: Record<NumericKey, readonly [number, number, number]> = {
  maxHopDepth: [3, 1, 3],
  maxTraversalNodeCount: [500, 1, 500],
  maxImpactDepth: [3, 1, 3],
  maxImpactNodeCount: [150, 1, 150],
  minSearchQueryLength: [2, 1, 10],
  defaultSearchPageSize: [25, 1, 100],
  maxSearchResults: [200, 1, 200],
  repositoryPageSize: [200, 1, 1000],
};

export const DEFAULT_GRAPH_SETTINGS: GraphSettings = {
  maxHopDepth: 3,
  maxTraversalNodeCount: 500,
  maxImpactDepth: 3,
  maxImpactNodeCount: 150,
  minSearchQueryLength: 2,
  defaultSearchPageSize: 25,
  maxSearchResults: 200,
  repositoryPageSize: 200,
  scanManagedPackageObjects: false,
  scanCustomizedStandardObjects: true,
  scanStandardPermissionSets: false,
};

function clampInt(value: unknown, [fallback, min, max]: readonly [number, number, number]): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function resolveGraphSettings(stored: unknown): GraphSettings {
  const raw = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const out: GraphSettings = { ...DEFAULT_GRAPH_SETTINGS };
  for (const key of Object.keys(NUMERIC_BOUNDS) as NumericKey[]) {
    out[key] = clampInt(raw[key], NUMERIC_BOUNDS[key]);
  }
  for (const key of ["scanManagedPackageObjects", "scanCustomizedStandardObjects", "scanStandardPermissionSets"] as const) {
    if (typeof raw[key] === "boolean") out[key] = raw[key] as boolean;
  }
  // A default page larger than the result cap would be unreachable.
  out.defaultSearchPageSize = Math.min(out.defaultSearchPageSize, out.maxSearchResults);
  return out;
}
