import type { RecordFragment, RecordNode, RecordOverview, SharingSettings } from "./graphApi";
import { RECORD_CHILD_EDGE, RECORD_PARENT_EDGE } from "./recordRelationshipView";

// Record mode's panel model (port of native oiNodeDetailPanel's record getters): pure transforms of a record
// fragment and a sharing read into the rows the Record Panel draws. Never calls the server.

export type ParentRow = { key: string; nodeKey: string; label: string; typeLabel: string; relationshipLabel: string };
export type ChildRow = { key: string; typeLabel: string; relationshipLabel: string; count: number };
export type RecordHierarchy = { parentRows: ParentRow[]; childRows: ChildRow[]; hasMore: boolean };

// System audit lookups every record has; listing them as "parents" would bury the business hierarchy. The
// Owner still shows in the Overview.
const SYSTEM_PARENT_FIELDS = new Set(["OwnerId", "CreatedById", "LastModifiedById"]);

// Every parent lookup and child record already sits in the same fragment that resolved the record, so this only
// groups what is there: one row per distinct parent record, and child records grouped by object and relationship
// field (a flat per-record list is unreadable for hundreds of children, and the per-relationship cap makes
// "3 shown" the honest framing rather than "exactly 3").
export function deriveRecordHierarchy(fragment: Pick<RecordFragment, "nodes" | "edges" | "hasMore">, centerNodeKey: string): RecordHierarchy {
  const nodesByKey = new Map(fragment.nodes.map((n) => [n.nodeKey, n]));
  const parentRows: ParentRow[] = [];
  const children = new Map<string, ChildRow>();
  for (const edge of fragment.edges) {
    if (edge.source !== centerNodeKey) continue;
    const target = nodesByKey.get(edge.target);
    if (!target) continue;
    if (edge.typeKey === RECORD_PARENT_EDGE) {
      if (edge.viaField && SYSTEM_PARENT_FIELDS.has(edge.viaField)) continue;
      parentRows.push({
        key: `${edge.viaField || "parent"}::${target.nodeKey}`,
        nodeKey: target.nodeKey,
        label: target.label,
        typeLabel: target.objectApiName,
        relationshipLabel: edge.viaField || "Parent relationship",
      });
    } else if (edge.typeKey === RECORD_CHILD_EDGE) {
      const key = `${target.typeKey}::${edge.viaField || "children"}`;
      const row = children.get(key) ?? { key, typeLabel: target.objectApiName, relationshipLabel: edge.viaField || "Child relationship", count: 0 };
      row.count += 1;
      children.set(key, row);
    }
  }
  return { parentRows, childRows: [...children.values()], hasMore: fragment.hasMore };
}

// The Hierarchy header count: every parent row is one record, every child row a per-relationship count.
export const hierarchyCount = (h: RecordHierarchy): number => h.parentRows.length + h.childRows.reduce((sum, r) => sum + r.count, 0);

const formatDateTime = (iso: string | null): string | null =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)) : null;

// The Overview grid, in on-screen order. Owner and dates appear only when the org returned them.
export function recordOverviewRows(node: Pick<RecordNode, "label" | "objectApiName" | "recordId">, overview: RecordOverview | null): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["Name", node.label],
    ["Object", node.objectApiName],
    ["Record Id", node.recordId],
  ];
  if (overview?.ownerName) rows.push(["Owner", overview.ownerName]);
  const created = formatDateTime(overview?.createdDate ?? null);
  const modified = formatDateTime(overview?.lastModifiedDate ?? null);
  if (created) rows.push(["Created", created]);
  if (modified) rows.push(["Last Modified", modified]);
  return rows;
}

// Same wording as Object mode's Sharing Settings rows: it is the exact same fact.
export function orgWideDefaultRows(owd: SharingSettings | null): Array<[string, string]> {
  if (!owd?.supported) return [];
  return [
    ["Internal Sharing Model", owd.internalSharingModel || "—"],
    ["External Sharing Model", owd.externalSharingModel || "Not enabled"],
  ];
}
