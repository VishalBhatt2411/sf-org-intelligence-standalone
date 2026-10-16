import type { ConnectionRow } from "./graphApi";
import type { MetadataNodeRef } from "./salesforceLinks";

// Pure logic behind the paged drill-down dialog (port of native oiIntelligenceDrilldown): sorting over the
// rows already loaded, which columns have anything to show, the count line and the Setup target of a row.

export const DRILLDOWN_PAGE_SIZE = 100;
export const SEARCH_DEBOUNCE_MS = 300;
export const SORT_NOTE = "Sorting applies to the results loaded so far.";

export type SortKey = "label" | "apiName" | "typeLabel";
export type SortDir = "asc" | "desc";
export type SortState = { key: SortKey; dir: SortDir } | null;

// Clicking a new column sorts it ascending; clicking the active one flips the direction.
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current && current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: "asc" };
}

// Blank values always sort last, whichever direction is active.
export function sortRows(rows: readonly ConnectionRow[], sort: SortState): ConnectionRow[] {
  if (!sort) return [...rows];
  const factor = sort.dir === "asc" ? 1 : -1;
  const value = (r: ConnectionRow) => {
    const v = r[sort.key];
    return typeof v === "string" && v.trim() ? v : null;
  };
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.index - b.index;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      return factor * a.v.localeCompare(b.v, undefined, { sensitivity: "base" }) || a.index - b.index;
    })
    .map((x) => x.row);
}

export type OptionalColumns = { status: boolean; dataType: boolean; references: boolean };

// Status, Data Type and References appear only when at least one loaded row has a value for them.
export function optionalColumns(rows: readonly ConnectionRow[]): OptionalColumns {
  return {
    status: rows.some((r) => r.status),
    dataType: rows.some((r) => r.dataType),
    references: rows.some((r) => r.referencedObject),
  };
}

export function countText(loading: boolean, totalCount: number, shown: number, isFiltered: boolean): string {
  if (loading) return "Loading…";
  const noun = totalCount === 1 ? "result" : "results";
  const base = `${totalCount.toLocaleString("en-US")} ${isFiltered ? "matching " : ""}${noun}`;
  return shown < totalCount ? `${base} · showing ${shown.toLocaleString("en-US")}` : base;
}

export function emptyStateCopy(isFiltered: boolean): { title: string; message: string } {
  return isFiltered
    ? { title: "No matches", message: "No results match your search." }
    : { title: "No connections", message: "No connections of this type were found in the scanned data." };
}

export const ERROR_TITLE = "Couldn't load these connections";
export const ERROR_FALLBACK = "Something went wrong loading these results.";

export function drilldownSubtitle(direction: "incoming" | "outgoing", relationshipLabel: string): string {
  return `${direction === "incoming" ? "Incoming" : "Outgoing"} · ${relationshipLabel}`;
}

const TYPE_PREFIX = "SalesforceMetadata.";

// The node reference metadataSetupTarget wants, from a row's type key and API name.
export function rowSetupRef(row: ConnectionRow): MetadataNodeRef {
  const kind = row.typeKey.startsWith(TYPE_PREFIX) ? row.typeKey.slice(TYPE_PREFIX.length) : row.typeKey;
  return { kind, fqn: row.apiName, label: row.label, attributes: row.isCustom === null ? undefined : { custom: row.isCustom } };
}
