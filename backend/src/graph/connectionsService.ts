import { clamp, GraphInputError, GraphNotFoundError } from "./errors";
import type { GraphReadRepository, StoredEdge, StoredNode } from "./graphReadRepository";
import { keyOf } from "./draft";
import { kindOfTypeKey, typeKeyOf } from "./keys";
import { edgeKindInfo, nodeKindInfo } from "./nodeTypes";
import { statusOf, type IntelligenceStatus } from "./intelligenceService";

// The paged drill-down behind every count the Intelligence panel shows (port of the native
// OI_NodeConnectionsService): one (node, direction, edge type) selection, a bounded page of display-ready
// rows, and the exact total. The selection is the same (direction, edge type) pair the panel's own count
// comes from, so the list can never disagree with the number that opened it.
//
// Ordered by edge key, which keeps cursor paging stable; sorting by name is the client's job, over the rows
// it has loaded. A search narrows the neighbour side first (bounded, like native), then filters the edges.

export const CONNECTIONS_DEFAULT_PAGE = 100;
export const CONNECTIONS_MAX_PAGE = 500;
export const SEARCH_CANDIDATE_CEILING = 2000;
// Most edges read for one selection. A node with more reports the selection as incomplete.
export const CONNECTIONS_EDGE_CAP = 20000;

export type ConnectionDirection = "incoming" | "outgoing";

export type ConnectionRow = {
  nodeKey: string;
  label: string;
  apiName: string;
  typeKey: string;
  typeLabel: string;
  relationshipLabel: string;
  // Stated from the neighbour's side: on an outgoing edge the neighbour is the target.
  roleLabel: string;
  direction: ConnectionDirection;
  viaFieldApiName: string | null;
  dataType: string | null;
  referencedObject: string | null;
  isCustom: boolean | null;
  status: IntelligenceStatus | null;
};

export type ConnectionPage = {
  rows: ConnectionRow[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  isFiltered: boolean;
  // Set only when the selection cannot be answered in full; the UI shows it instead of a table.
  unavailableReason: string | null;
};

export type ConnectionsQuery = { direction: string; edgeTypeKey: string; pageSize?: number; cursor?: string; search?: string };

const stringOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) return value.length ? value.map(String).join(", ") : null;
  return String(value);
};

// "Update Account" from the edge kind "UPDATES" style keys; registered kinds read as words.
const relationshipLabelOf = (edgeTypeKey: string): string => {
  const kind = edgeKindInfo(edgeTypeKey)?.kind ?? kindOfTypeKey(edgeTypeKey);
  if (!kind) return "Related";
  return kind
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

export class ConnectionsService {
  constructor(private readonly repo: GraphReadRepository) {}

  async connections(connectionId: string, nodeKey: string, query: ConnectionsQuery): Promise<ConnectionPage> {
    if (query.direction !== "incoming" && query.direction !== "outgoing") throw new GraphInputError('direction must be "outgoing" or "incoming"');
    if (!query.edgeTypeKey) throw new GraphInputError("edgeTypeKey is required");
    const direction: ConnectionDirection = query.direction;
    const outgoing = direction === "outgoing";
    const pageSize = clamp(query.pageSize && query.pageSize > 0 ? query.pageSize : CONNECTIONS_DEFAULT_PAGE, 1, CONNECTIONS_MAX_PAGE);
    const term = (query.search ?? "").trim();
    const isFiltered = term.length > 0;

    const [anchor] = await this.repo.getNodes(connectionId, [nodeKey]);
    if (!anchor) throw new GraphNotFoundError("Node not found");

    let candidates: Set<string> | null = null;
    if (isFiltered) {
      candidates = new Set((await this.repo.searchNodes(connectionId, term, SEARCH_CANDIDATE_CEILING)).map((n) => n.nodeKey));
      if (candidates.size === 0) return { rows: [], totalCount: 0, hasMore: false, nextCursor: null, isFiltered, unavailableReason: null };
    }

    const read = await this.repo.edgesOf(connectionId, [nodeKey], { direction: outgoing ? "out" : "in", typeKeys: [query.edgeTypeKey], limit: CONNECTIONS_EDGE_CAP });
    if (read.length >= CONNECTIONS_EDGE_CAP) {
      return { rows: [], totalCount: 0, hasMore: false, nextCursor: null, isFiltered, unavailableReason: `This component has more than ${CONNECTIONS_EDGE_CAP.toLocaleString("en-US")} connections of this type, which is more than can be listed here.` };
    }
    const neighbourOf = (e: StoredEdge) => (outgoing ? e.targetNodeKey : e.sourceNodeKey);
    const selected = read.filter((e) => (outgoing ? e.sourceNodeKey === nodeKey : e.targetNodeKey === nodeKey) && (!candidates || candidates.has(neighbourOf(e))));

    const after = query.cursor ? selected.filter((e) => e.edgeKey > query.cursor!) : selected;
    // One extra row is how hasMore is known; it is trimmed, never rendered.
    const page = after.slice(0, pageSize + 1);
    const hasMore = page.length > pageSize;
    if (hasMore) page.pop();

    const nodes = new Map<string, StoredNode>((await this.repo.getNodes(connectionId, [...new Set(page.map(neighbourOf))])).map((n) => [n.nodeKey, n]));
    const info = edgeKindInfo(query.edgeTypeKey);
    const relationshipLabel = relationshipLabelOf(query.edgeTypeKey);
    const roleLabel = (outgoing ? info?.targetRole : info?.sourceRole) ?? "Related To";

    const rows: ConnectionRow[] = [];
    for (const e of page) {
      const n = nodes.get(neighbourOf(e));
      // A missing neighbour is skipped, never rendered as a placeholder.
      if (!n) continue;
      const a = n.attributes;
      rows.push({
        nodeKey: n.nodeKey,
        label: n.label,
        apiName: n.fqn,
        typeKey: n.typeKey,
        typeLabel: nodeKindInfo(n.typeKey)?.label ?? kindOfTypeKey(n.typeKey),
        relationshipLabel,
        roleLabel,
        direction,
        viaFieldApiName: stringOrNull(a.relationshipName),
        dataType: stringOrNull(a.type),
        referencedObject: stringOrNull(a.referenceTo),
        isCustom: typeof a.custom === "boolean" ? a.custom : null,
        status: statusOf(n),
      });
    }

    return { rows, totalCount: selected.length, hasMore, nextCursor: hasMore && page.length ? page[page.length - 1].edgeKey : null, isFiltered, unavailableReason: null };
  }

  // The object's own Lookup / Master-Detail fields, read from the scanned graph (no live describe): the
  // outgoing relationship table's rows. Required comes from nillable; null when the scan did not say.
  async relationshipFields(connectionId: string, nodeKey: string): Promise<RelationshipFieldRow[]> {
    const [anchor] = await this.repo.getNodes(connectionId, [nodeKey]);
    if (!anchor) throw new GraphNotFoundError("Node not found");
    const edges = await this.repo.edgesOf(connectionId, [nodeKey], { direction: "out", typeKeys: [typeKeyOf("HAS_FIELD")], limit: CONNECTIONS_EDGE_CAP });
    const fields = await this.repo.getNodes(connectionId, [...new Set(edges.map((e) => e.targetNodeKey))]);
    const rows: RelationshipFieldRow[] = [];
    for (const f of fields) {
      const a = f.attributes;
      const referenceTo = Array.isArray(a.referenceTo) ? a.referenceTo.map(String).filter(Boolean) : [];
      if (referenceTo.length === 0) continue;
      const name = f.fqn.slice(f.fqn.lastIndexOf(".") + 1);
      rows.push({
        nodeKey: f.nodeKey,
        apiName: name,
        label: f.label,
        type: typeof a.type === "string" ? a.type : null,
        referenceTo,
        masterDetail: a.masterDetail === true || a.relationship === "MasterDetail",
        required: typeof a.nillable === "boolean" ? !a.nillable : null,
        relationshipName: stringOrNull(a.relationshipName),
        custom: typeof a.custom === "boolean" ? a.custom : name.endsWith("__c"),
      });
    }
    return rows.sort((x, y) => x.label.localeCompare(y.label) || x.apiName.localeCompare(y.apiName));
  }

  // Field API name -> node key for one object, so a listed field opens by its server key even when it is
  // off the canvas. Empty when the object itself is not in the scan.
  async fieldNodeKeys(connectionId: string, objectApiName: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const objectKey = keyOf("CustomObject", objectApiName);
    const edges = await this.repo.edgesOf(connectionId, [objectKey], { direction: "out", typeKeys: [typeKeyOf("HAS_FIELD")], limit: CONNECTIONS_EDGE_CAP });
    if (edges.length === 0) return out;
    for (const f of await this.repo.getNodes(connectionId, [...new Set(edges.map((e) => e.targetNodeKey))])) {
      out.set(f.fqn.slice(f.fqn.lastIndexOf(".") + 1), f.nodeKey);
    }
    return out;
  }
}

export type RelationshipFieldRow = {
  nodeKey: string;
  apiName: string;
  label: string;
  type: string | null;
  referenceTo: string[];
  masterDetail: boolean;
  required: boolean | null;
  relationshipName: string | null;
  custom: boolean;
};
