import type { GraphNode, IntelligenceEmptyState, IntelligenceItem, ObjectField } from "./graphApi";
import type { ObjectRelationshipView } from "./objectRelationshipView";

// Pure presentation rules for the Intelligence Panel (port of the native oiNodeDetailPanel helpers):
// labels, filters, grouping and counts. No I/O and no React, so each rule is unit-tested on its own.

// Attributes the panel already shows as curated rows; the Technical Details table leaves them out.
export const CURATED_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set(["label", "custom", "namespace", "type", "referenceTo", "relationshipName"]);

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

export type FieldFilter = "all" | "standard" | "custom";

export type FieldMetrics = { total: number; standard: number; custom: number; relationship: number };

export function fieldMetrics(fields: readonly ObjectField[]): FieldMetrics {
  const custom = fields.filter((f) => f.custom).length;
  return { total: fields.length, standard: fields.length - custom, custom, relationship: fields.filter((f) => f.referenceTo.length > 0).length };
}

export function filterFields(fields: readonly ObjectField[], query: string, filter: FieldFilter): ObjectField[] {
  const needle = query.trim().toLowerCase();
  return fields.filter((f) => {
    if (filter === "custom" && !f.custom) return false;
    if (filter === "standard" && f.custom) return false;
    return !needle || f.label.toLowerCase().includes(needle) || f.name.toLowerCase().includes(needle) || f.type.toLowerCase().includes(needle);
  });
}

// Relationship fields of the object itself (what it points at), in the order describe returns them.
export const outgoingRelationshipFields = (fields: readonly ObjectField[]): ObjectField[] => fields.filter((f) => f.referenceTo.length > 0);

export const relationshipKindLabel = (f: ObjectField): string => (f.masterDetail ? "Master-Detail" : "Lookup");

export const yesNoUnknown = (value: boolean | null): string => (value === null ? "Unknown" : value ? "Yes" : "No");

export const MAX_INLINE_TARGETS = 5;

export function formatTargets(targets: readonly string[], label: (name: string) => string = (n) => n): { text: string; title: string } {
  const labels = targets.map(label);
  const shown = labels.slice(0, MAX_INLINE_TARGETS).join(", ");
  const more = labels.length - MAX_INLINE_TARGETS;
  return { text: more > 0 ? `${shown}, +${more} more` : shown, title: labels.join(", ") };
}

export const distinctTargets = (fields: readonly ObjectField[]): string[] => [...new Set(fields.flatMap((f) => f.referenceTo))].sort((a, b) => a.localeCompare(b));

// "Account" -> "Account (12 records)" / "Account (count unavailable)"; a target the server did not count stays bare.
export function targetWithCount(name: string, counts: Readonly<Record<string, number | null>> | undefined): string {
  if (!counts || !(name in counts)) return name;
  const n = counts[name];
  return n === null ? `${name} (count unavailable)` : `${name} (${n.toLocaleString()} ${n === 1 ? "record" : "records"})`;
}

export type IntelligenceGroup = {
  typeKey: string;
  label: string;
  items: IntelligenceItem[];
  // All items share one direction and edge type, so the group can open as a drill-down list.
  drillDown: boolean;
};

export function groupIntelligenceItems(items: readonly IntelligenceItem[]): IntelligenceGroup[] {
  const groups = new Map<string, IntelligenceGroup>();
  for (const item of items) {
    let group = groups.get(item.typeKey);
    if (!group) {
      group = { typeKey: item.typeKey, label: item.kindLabel, items: [], drillDown: true };
      groups.set(item.typeKey, group);
    }
    group.items.push(item);
  }
  for (const group of groups.values()) {
    const first = group.items[0];
    group.drillDown = group.items.every((i) => i.direction === first.direction && i.edgeTypeKey === first.edgeTypeKey);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export const directionLabel = (direction: "in" | "out"): string => (direction === "in" ? "uses this" : "used by this");

export type RelationshipCounts = {
  incomingLookups: number;
  incomingMasterDetail: number;
  // Distinct objects in the canvas working set; the panel omits them when no working set is available.
  selfRelationships: number;
  referencedObjects: number;
  referencingObjects: number;
};

export function relationshipCounts(view: ObjectRelationshipView | null): RelationshipCounts | null {
  if (!view?.rootObject) return null;
  const incomingFields = view.incomingRelationships.flatMap((c) => c.fields);
  return {
    incomingLookups: incomingFields.filter((f) => f.relationshipType === "Lookup").length,
    incomingMasterDetail: incomingFields.filter((f) => f.relationshipType === "MasterDetail").length,
    selfRelationships: view.selfRelationships.reduce((sum, c) => sum + c.fields.length, 0),
    referencedObjects: view.counts.outgoingTotal,
    referencingObjects: view.counts.incomingTotal,
  };
}

export type DrillEntry = { nodeKey: string; label: string; detail: string | null };

// Counterpart objects behind the "Incoming Lookups" / "Incoming Master-Detail" counts.
export function incomingDrillEntries(view: ObjectRelationshipView | null, type: "Lookup" | "MasterDetail"): DrillEntry[] {
  if (!view) return [];
  return view.incomingRelationships.flatMap((c) =>
    c.fields.filter((f) => f.relationshipType === type).map((f) => ({ nodeKey: c.counterpartObject.nodeKey, label: c.counterpartObject.label, detail: f.fieldFqn })),
  );
}

export function overviewRows(node: GraphNode, parentLabel: string | null): Array<[string, string]> {
  const custom = typeof node.attributes?.custom === "boolean" ? node.attributes.custom : node.fqn.split(".").pop()!.endsWith("__c");
  const customText = custom ? "Custom" : "Standard";
  if (node.kind === "CustomObject") {
    const rows: Array<[string, string]> = [];
    if (node.label !== node.fqn) rows.push(["Name", node.label]);
    rows.push(["API Name", node.fqn], ["Type", custom ? "Custom Object" : "Standard Object"], ["Namespace", node.namespace || "—"], ["Custom / Standard", customText]);
    return rows;
  }
  if (node.kind === "CustomField") {
    const dot = node.fqn.indexOf(".");
    const type = typeof node.attributes?.type === "string" && node.attributes.type ? node.attributes.type : "—";
    return [
      ["Name", node.label],
      ["API Name", dot === -1 ? node.fqn : node.fqn.slice(dot + 1)],
      ["Type", node.kindLabel],
      ["Data Type", type],
      ["Custom / Standard", customText],
      ["Parent Object", parentLabel ?? (dot === -1 ? "—" : node.fqn.slice(0, dot))],
    ];
  }
  const rows: Array<[string, string]> = [["Name", node.label], ["API Name", node.fqn], ["Type", node.kindLabel]];
  if (node.namespace) rows.push(["Namespace", node.namespace]);
  return rows;
}
