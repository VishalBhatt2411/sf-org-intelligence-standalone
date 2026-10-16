import type { EdgeSummaryRow, GraphNode, ImpactDirection, ImpactNode, IntelligenceEmptyState, IntelligenceItem, ObjectField, RelationshipField } from "./graphApi";
import { isSystemField, type ObjectRelationshipView, type VisibilityMode } from "./objectRelationshipView";

// Pure presentation rules for the Intelligence Panel (port of the native oiNodeDetailPanel helpers):
// labels, filters, grouping and counts. No I/O and no React, so each rule is unit-tested on its own.

// Attributes the panel already shows as curated rows; the Technical Details table leaves them out.
export const CURATED_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set(["label", "custom", "namespace", "type", "referenceTo", "relationshipName", "relationship", "masterDetail", "fieldCount", "customFieldCount"]);

export const technicalAttributes = (node: Pick<GraphNode, "attributes">): Array<[string, unknown]> =>
  Object.entries(node.attributes ?? {}).filter(([key]) => !CURATED_ATTRIBUTE_KEYS.has(key));

// "Apex Class" -> "Apex Classes", "Sharing Rule" -> "Sharing Rules", "Entity" -> "Entities", "Day" -> "Days".
export function pluralizeTypeLabel(label: string): string {
  if (/(s|x|z|ch|sh)$/i.test(label)) return `${label}es`;
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  return `${label}s`;
}

// Says why an Intelligence list is empty, so a scan gap is never presented as a clean bill of health.
export function buildEmptyStateMessage(label: string, kind: IntelligenceEmptyState): string {
  const lower = label.toLowerCase();
  switch (kind) {
    case "unscanned":
      return `${label} data has not been scanned yet.`;
    case "stale":
      return `Results shown are from an older scan — rescan to refresh ${lower} data.`;
    case "incomplete":
      return `${label} results may be incomplete for this org — see the coverage note below.`;
    default:
      return `No ${lower} detected for this component.`;
  }
}

// ---- Fields -------------------------------------------------------------------------------------------

export type FieldFilter = "all" | "standard" | "custom";

export type FieldMetrics = { total: number; standard: number; custom: number; relationship: number };

export function fieldMetrics(fields: readonly ObjectField[]): FieldMetrics {
  const custom = fields.filter((f) => f.custom).length;
  return { total: fields.length, standard: fields.length - custom, custom, relationship: fields.filter((f) => f.referenceTo.length > 0).length };
}

export type FieldTotals = { total: number | null; standard: number | null; custom: number | null; relationship: number | null };

const finiteNumber = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Tile numbers. Before the field list loads they come from what the scan stored on the object (native reads the
// same counts): Total is the stored field count, else the HAS_FIELD out count; Standard and Custom need both
// stored counts; Relationship stays unknown. Once the list is loaded every tile counts that list.
export function fieldTotals(node: Pick<GraphNode, "attributes">, edgeSummary: readonly EdgeSummaryRow[], loaded?: readonly ObjectField[]): FieldTotals {
  if (loaded) return fieldMetrics(loaded);
  const count = finiteNumber(node.attributes?.fieldCount);
  const custom = finiteNumber(node.attributes?.customFieldCount);
  const hasFieldOut = edgeSummary.find((r) => r.direction === "out" && r.typeKey.endsWith("HAS_FIELD"))?.count ?? null;
  const total = count ?? hasFieldOut;
  return { total, standard: count !== null && custom !== null ? Math.max(count - custom, 0) : null, custom: count !== null && custom !== null ? custom : null, relationship: null };
}

// The Fields section only appears for an object that has fields.
export const hasFields = (totals: FieldTotals): boolean => (totals.total ?? 0) > 0;

export const sortFieldsByLabel = <T extends { label: string }>(fields: readonly T[]): T[] => [...fields].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

export function filterFields(fields: readonly ObjectField[], query: string, filter: FieldFilter): ObjectField[] {
  const needle = query.trim().toLowerCase();
  return fields.filter((f) => {
    if (filter === "custom" && !f.custom) return false;
    if (filter === "standard" && f.custom) return false;
    return !needle || f.label.toLowerCase().includes(needle) || f.name.toLowerCase().includes(needle) || f.type.toLowerCase().includes(needle);
  });
}

export const FIELD_ROW_OPEN_TITLE = "Open this field in the graph";
export const FIELD_ROW_LIVE_ONLY_TITLE = "Listed from live schema. Only relationship fields are graph nodes.";
export const fieldRowTitle = (nodeKey: string | null | undefined): string => (nodeKey ? FIELD_ROW_OPEN_TITLE : FIELD_ROW_LIVE_ONLY_TITLE);

export const FIELDS_EMPTY = { title: "No fields", message: "This object has no scanned fields." };
export const FIELDS_NO_MATCH = { title: "No matches", message: "No fields match your search." };
export const FIELDS_ERROR_TITLE = "Couldn't load fields";
export const FIELDS_ERROR_FALLBACK = "Something went wrong loading fields.";

// ---- Outgoing relationship fields ---------------------------------------------------------------------

export const relationshipKindLabel = (f: { masterDetail: boolean }): string => (f.masterDetail ? "Master-Detail" : "Lookup");

export const yesNoUnknown = (value: boolean | null): string => (value === null ? "Unknown" : value ? "Yes" : "No");

// Salesforce reports delete behaviour for a Lookup only through a different attribute than the scan keeps, so
// only Master-Detail is known to cascade.
export const cascadeDeleteLabel = (f: { masterDetail: boolean }): string => (f.masterDetail ? "Cascade" : "Not available");

export const MAX_INLINE_TARGETS = 5;

export function formatTargets(targets: readonly string[], label: (name: string) => string = (n) => n): { text: string; title: string } {
  const labels = targets.map(label);
  const shown = labels.slice(0, MAX_INLINE_TARGETS).join(", ");
  const more = labels.length - MAX_INLINE_TARGETS;
  return { text: more > 0 ? `${shown}, +${more} more` : shown, title: labels.join(", ") };
}

export const distinctTargets = (fields: ReadonlyArray<{ referenceTo: readonly string[] }>): string[] => [...new Set(fields.flatMap((f) => f.referenceTo))].sort((a, b) => a.localeCompare(b));

// "Account" -> "Account (1,234 records)" / "Account (count unavailable)"; a target the server did not count stays bare.
export function targetWithCount(name: string, counts: Readonly<Record<string, number | null>> | undefined): string {
  if (!counts || !(name in counts)) return name;
  const n = counts[name];
  return n === null ? `${name} (count unavailable)` : `${name} (${n.toLocaleString("en-US")} ${n === 1 ? "record" : "records"})`;
}

export type OutgoingFieldRow = {
  nodeKey: string;
  apiName: string;
  label: string;
  type: string;
  required: string;
  cascadeDelete: string;
  targets: string[];
};

// The Business / System / All filter of the canvas decides whether system lookups (OwnerId, CreatedById,
// LastModifiedById) appear in this table too.
export function outgoingFieldRows(fields: readonly RelationshipField[], mode: VisibilityMode = "all"): OutgoingFieldRow[] {
  return fields
    .filter((f) => (mode === "all" ? true : mode === "system" ? isSystemField(f.apiName) : !isSystemField(f.apiName)))
    .map((f) => ({ nodeKey: f.nodeKey, apiName: f.apiName, label: f.label, type: relationshipKindLabel(f), required: yesNoUnknown(f.required), cascadeDelete: cascadeDeleteLabel(f), targets: f.referenceTo }));
}

export const OUTGOING_HEADING = "Outgoing relationships";
export const OUTGOING_EMPTY = { title: "No outgoing relationships", message: "This object has no Lookup or Master-Detail fields of its own." };
export const LOAD_COUNTS_LABEL = "Load record counts";
export const LOAD_COUNTS_TITLE = "Fetch a live record count for every target object above";
export const COUNTS_ERROR_TITLE = "Couldn't load record counts";
export const COUNTS_TRUNCATED_NOTE = "Some target objects were beyond the limit for a live record count and show no count here.";

// ---- Intelligence groups ------------------------------------------------------------------------------

export type IntelligenceGroup = {
  // subTypeKey when the item has one (a Process Builder flow), else its type key.
  groupKey: string;
  typeKey: string;
  label: string;
  items: IntelligenceItem[];
  // All items share one direction and edge type, so the group can open as a server drill-down; otherwise it
  // expands inline.
  drillDown: boolean;
  direction: "in" | "out";
  edgeTypeKey: string;
};

export function groupIntelligenceItems(items: readonly IntelligenceItem[]): IntelligenceGroup[] {
  const groups = new Map<string, IntelligenceGroup>();
  for (const item of items) {
    const groupKey = item.subTypeKey || item.typeKey;
    let group = groups.get(groupKey);
    if (!group) {
      group = { groupKey, typeKey: item.typeKey, label: item.subTypeLabel || item.kindLabel, items: [], drillDown: true, direction: item.direction, edgeTypeKey: item.edgeTypeKey };
      groups.set(groupKey, group);
    }
    group.items.push(item);
  }
  for (const group of groups.values()) {
    const first = group.items[0];
    group.drillDown = group.items.every((i) => i.direction === first.direction && i.edgeTypeKey === first.edgeTypeKey);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export const GROUP_DRILL_TITLE = "Show these connections";

// The drill-down's direction names are the connection side seen from the anchor: an item that uses this
// component is an incoming connection.
export const drillDirection = (direction: "in" | "out"): "incoming" | "outgoing" => (direction === "in" ? "incoming" : "outgoing");

export const directionLabel = (direction: "in" | "out"): string => (direction === "in" ? "uses this" : "used by this");

// ---- Relationships ------------------------------------------------------------------------------------

export type RelationshipCounts = { selfRelationships: number; referencedObjects: number; referencingObjects: number };

// Connector counts of the canvas, only meaningful for the centre object (null for any other node).
export function relationshipCounts(view: ObjectRelationshipView | null): RelationshipCounts | null {
  if (!view?.rootObject) return null;
  return { selfRelationships: view.selfRelationships.length, referencedObjects: view.outgoingRelationships.length, referencingObjects: view.incomingRelationships.length };
}

export const LOOKUP_EDGE_SUFFIX = "LOOKUP_TO";
export const MASTER_DETAIL_EDGE_SUFFIX = "MASTER_DETAIL_TO";
export const LOOKUP_EDGE_TYPE_KEY = "SalesforceMetadata.LOOKUP_TO";
export const MASTER_DETAIL_EDGE_TYPE_KEY = "SalesforceMetadata.MASTER_DETAIL_TO";

// Incoming Lookups / Master-Detail come from the stored graph's edge counts, so they cover the whole scan and
// not just the canvas working set. Zero when the object has none.
export function incomingEdgeCounts(edgeSummary: readonly EdgeSummaryRow[]): { incomingLookups: number; incomingMasterDetail: number } {
  const sum = (suffix: string) => edgeSummary.filter((r) => r.direction === "in" && r.typeKey.endsWith(suffix)).reduce((n, r) => n + r.count, 0);
  return { incomingLookups: sum(LOOKUP_EDGE_SUFFIX), incomingMasterDetail: sum(MASTER_DETAIL_EDGE_SUFFIX) };
}

export type RelationshipListRow = {
  key: string;
  label: string;
  count: number;
  direction: "incoming" | "outgoing";
  edgeTypeKey: string;
  // The label the drill-down shows after the direction.
  relationshipLabel: string;
};

const humanize = (kind: string) => kind.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// Generic relationship rows for any node: "Outgoing — {role}" / "Incoming — {role}", one per edge type and
// direction, each drillable.
export function relationshipRows(edgeSummary: readonly EdgeSummaryRow[]): RelationshipListRow[] {
  return edgeSummary.map((r) => {
    const name = r.role || humanize(r.kind);
    const outgoing = r.direction === "out";
    return { key: `${r.typeKey}:${r.direction}`, label: `${outgoing ? "Outgoing" : "Incoming"} — ${name}`, count: r.count, direction: outgoing ? "outgoing" : "incoming", edgeTypeKey: r.typeKey, relationshipLabel: name };
  });
}

export const directConnectionNote = (count: number): string =>
  `${count} directly connected metadata component${count === 1 ? "" : "s"} — schema relationships only (Lookup / Master-Detail). Automation, code, and security dependencies are shown in their own sections below.`;

// ---- Impact -------------------------------------------------------------------------------------------

export const IMPACT_ERROR_TITLE = "Couldn't compute impact";
export const IMPACT_ERROR_FALLBACK = "Something went wrong computing impact analysis.";
export const IMPACT_EMPTY = { title: "No dependencies", message: "No dependencies found in the currently-scanned data." };

export const impactColumnHeader = (direction: ImpactDirection): string => (direction === "upstream" ? "What does this depend on" : "What depends on this");

// One pill per type, in the order types first appear in the result. A single type adds no information, so
// the breakdown is hidden.
export function impactTypeBreakdown(nodes: readonly Pick<ImpactNode, "typeKey" | "kindLabel">[]): Array<{ typeKey: string; label: string; count: number }> {
  const order = new Map<string, { typeKey: string; label: string; count: number }>();
  for (const n of nodes) {
    const entry = order.get(n.typeKey) ?? { typeKey: n.typeKey, label: "", count: 0 };
    if (!entry.label) entry.label = n.kindLabel;
    entry.count += 1;
    order.set(n.typeKey, entry);
  }
  const list = [...order.values()].map((e) => ({ ...e, label: e.count === 1 ? e.label : pluralizeTypeLabel(e.label) }));
  return list.length > 1 ? list : [];
}

// ---- Overview / field relationship ---------------------------------------------------------------------

const attrString = (node: Pick<GraphNode, "attributes">, key: string): string | null => {
  const v = node.attributes?.[key];
  return typeof v === "string" && v.trim() ? v : null;
};

// The fixed "Custom" / "Standard" wording, shown only when the node says which it is.
const customRow = (node: Pick<GraphNode, "attributes">): Array<[string, string]> =>
  typeof node.attributes?.custom === "boolean" ? [["Custom / Standard", node.attributes.custom ? "Custom" : "Standard"]] : [];

export function overviewRows(node: GraphNode, parentLabel: string | null): Array<[string, string]> {
  if (node.kind === "CustomField") {
    const dot = node.fqn.indexOf(".");
    const apiName = dot === -1 ? node.fqn : node.fqn.slice(dot + 1);
    const rows: Array<[string, string]> = [];
    if (node.label !== apiName && node.label !== node.fqn) rows.push(["Name", node.label]);
    rows.push(["API Name", apiName], ["Type", node.kindLabel], ["Data Type", attrString(node, "type") ?? "—"], ...customRow(node), ["Parent Object", parentLabel ?? (dot === -1 ? "—" : node.fqn.slice(0, dot))]);
    return rows;
  }
  const rows: Array<[string, string]> = [];
  if (node.label !== node.fqn) rows.push(["Name", node.label]);
  rows.push(["API Name", node.fqn]);
  if (node.kind === "CustomObject") {
    const custom = typeof node.attributes?.custom === "boolean" ? node.attributes.custom : null;
    rows.push(["Type", custom === null ? node.kindLabel : custom ? "Custom Object" : "Standard Object"], ["Namespace", node.namespace || "—"], ...customRow(node));
    return rows;
  }
  rows.push(["Type", node.kindLabel]);
  if (node.namespace) rows.push(["Namespace", node.namespace]);
  rows.push(...customRow(node));
  return rows;
}

// The "Relationship" section of a field: only rows the scan actually has, and the section itself only when
// there is at least one.
export function fieldRelationshipRows(node: Pick<GraphNode, "attributes">): Array<[string, string]> {
  const attrs = node.attributes ?? {};
  const kind = attrs.masterDetail === true || attrs.relationship === "MasterDetail" ? "Master-Detail" : attrs.relationship === "Lookup" ? "Lookup" : typeof attrs.relationship === "string" && attrs.relationship ? attrs.relationship : null;
  const targets = Array.isArray(attrs.referenceTo) ? attrs.referenceTo.filter((t): t is string => typeof t === "string" && t.length > 0) : [];
  const name = attrString(node, "relationshipName");
  const rows: Array<[string, string]> = [];
  if (kind) rows.push(["Relationship Type", kind]);
  if (targets.length > 0) rows.push(["Target Object", targets.join(", ")]);
  if (name) rows.push(["Relationship Name", name]);
  return rows;
}

export const DETAIL_ERROR_TITLE = "Couldn't load this component";
export const DETAIL_MISSING = "No detail available";
