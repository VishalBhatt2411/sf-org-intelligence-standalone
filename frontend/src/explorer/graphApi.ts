import { api } from "../api/client";

// Wire shapes of the graph read API (backend/src/graph/graphDto.ts and the read services). The UI never
// builds nodes or relationships itself: everything it draws comes back from these calls.

export type Confidence = "exact" | "parsed" | "heuristic";
export type EdgeStyle = "solid" | "dashed" | "dotted";

export type GraphNode = {
  nodeKey: string;
  typeKey: string;
  kind: string;
  kindLabel: string;
  categories: string[];
  label: string;
  fqn: string;
  namespace: string | null;
  parentKey: string | null;
  checksum: string;
  attributes: Record<string, unknown>;
};

export type GraphEdge = {
  edgeKey: string;
  typeKey: string;
  kind: string;
  style: EdgeStyle;
  sourceRole: string;
  targetRole: string;
  source: string;
  target: string;
  confidence: Confidence;
  viaField: string | null;
  attributes: Record<string, unknown>;
};

export type RingNode = GraphNode & { ring: number };
// A node the client already holds at this checksum: identity and ring only.
export type UnchangedNode = { nodeKey: string; checksum: string; ring: number; unchanged: true };

export type ExpandResponse = {
  root: string;
  hops: number;
  nodes: Array<RingNode | UnchangedNode>;
  edges: GraphEdge[];
  nextCursor: string | null;
  truncated: boolean;
};

export type ImpactDirection = "downstream" | "upstream";
export type ImpactNode = GraphNode & { distance: number };
export type Caveat = { code: string; message: string };

export type ImpactResponse = {
  root: GraphNode;
  direction: ImpactDirection;
  depth: number;
  nodes: ImpactNode[];
  edges: GraphEdge[];
  summary: Array<{ typeKey: string; kindLabel: string; count: number }>;
  truncated: boolean;
  hasCycle: boolean;
  cycleNodeKeys: string[];
  caveats: Caveat[];
};

export type EdgeSummaryRow = {
  typeKey: string;
  kind: string;
  direction: "out" | "in";
  role: string;
  count: number;
  confidence: Record<Confidence, number>;
};

export type RelatedEdge = GraphEdge & {
  direction: "out" | "in";
  other: Pick<GraphNode, "nodeKey" | "typeKey" | "kindLabel" | "label" | "fqn">;
};

export type NodeDetail = {
  node: GraphNode;
  parent: GraphNode | null;
  edgeSummary: EdgeSummaryRow[];
  edges: RelatedEdge[];
  edgeTotal: number;
  capped: boolean;
};

export type GraphCoverageLevel = "complete" | "partial" | "degraded";

export type GraphSummary = {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Array<{ typeKey: string; kind: string; kindLabel: string; count: number }>;
  edgesByType: Array<{ typeKey: string; kind: string; count: number }>;
  coverage: GraphCoverageLevel | "none";
  lastScan: { scanId: string; finishedAt: string | null } | null;
  stages: Array<{ category: string; coverage: GraphCoverageLevel | null; detail: string | null; itemCount: number }>;
};

export type NodeList = { nodes: GraphNode[]; truncated: boolean };
export type SearchResponse = NodeList & { query: string };

export type ObjectField = {
  // The scanned graph node of this field; null when it is not a graph node (listed from the live schema only).
  nodeKey?: string | null;
  name: string;
  label: string;
  type: string;
  referenceTo: string[];
  masterDetail: boolean;
  custom: boolean;
  // Null when the org did not say (relationship-only reads).
  required: boolean | null;
  cascadeDelete: boolean | null;
  relationshipName: string | null;
};

export type ObjectFields = { apiName: string; fields: ObjectField[] };

export type SharingSettings = {
  supported: boolean;
  internalSharingModel: string | null;
  externalSharingModel: string | null;
  unavailableReason: string | null;
};

export type RecordCounts = { counts: Record<string, number | null>; truncated: boolean };

export type IntelligenceCategoryKey = "automation" | "code" | "security";
export type IntelligenceStatus = "active" | "inactive" | "draft" | "obsolete";
export type IntelligenceEmptyState = "unscanned" | "incomplete" | "stale" | "none";

export type IntelligenceItem = {
  nodeKey: string;
  label: string;
  typeKey: string;
  kindLabel: string;
  // "in": the item uses this component. "out": this component uses the item.
  direction: "in" | "out";
  edgeTypeKey: string;
  status: IntelligenceStatus | null;
  // A finer grouping inside a type (a Flow that is a Process Builder); null for most items.
  subTypeKey?: string | null;
  subTypeLabel?: string | null;
};

// The paged drill-down behind an Intelligence count (backend connectionsService).
export type ConnectionDirection = "incoming" | "outgoing";
export type ConnectionRow = {
  nodeKey: string;
  label: string;
  apiName: string;
  typeKey: string;
  typeLabel: string;
  relationshipLabel: string;
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
  unavailableReason: string | null;
};
export type ConnectionsQuery = { direction: ConnectionDirection; edgeTypeKey: string; pageSize?: number; cursor?: string | null; q?: string };

// An object's own Lookup / Master-Detail field from the scanned graph.
export type RelationshipField = {
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

export type IntelligenceCategory = {
  category: IntelligenceCategoryKey;
  label: string;
  items: IntelligenceItem[];
  total: number;
  truncated: boolean;
  emptyState: IntelligenceEmptyState;
  coverageNote: string | null;
};

export type NodeIntelligence = {
  nodeKey: string;
  lastScannedAt: string | null;
  hasCoverageLimitations: boolean;
  categories: IntelligenceCategory[];
};

// Record mode: live reads of one object's records and one record's neighbours; never part of the stored graph.
export type RecordSummary = { recordId: string; label: string; objectApiName: string };
export type RecordNode = { nodeKey: string; typeKey: string; label: string; objectApiName: string; recordId: string };
export type RecordEdge = { edgeKey: string; typeKey: string; source: string; target: string; viaField: string | null };
export type RecordOverview = { ownerName: string | null; createdDate: string | null; lastModifiedDate: string | null };
export type RecordFragment = { centerNodeKey: string | null; nodes: RecordNode[]; edges: RecordEdge[]; hasMore: boolean; overview: RecordOverview | null };
export type RecordShareRow = { userOrGroupId: string | null; userOrGroupLabel: string | null; accessLevel: string | null; rowCause: string | null };
export type RecordSharing = {
  // False when the object has no share table of its own: "not applicable", which reads differently from "nobody".
  supportsSharing: boolean;
  coverageNote: string | null;
  shareRows: RecordShareRow[];
  truncated: boolean;
  isLockedByApproval: boolean;
  pendingApprovalDetail: string | null;
  orgWideDefault: SharingSettings | null;
};

export function graphApi(connectionId: string) {
  const base = `/connections/${connectionId}/graph`;
  const node = (nodeKey: string) => `${base}/nodes/${encodeURIComponent(nodeKey)}`;
  return {
    summary: () => api.get<GraphSummary>(`${base}/summary`).then((r) => r.data),
    search: (q: string, opts: { limit?: number; typeKey?: string } = {}) =>
      api.get<SearchResponse>(`${base}/search`, { params: { q, limit: opts.limit ?? 25, typeKey: opts.typeKey } }).then((r) => r.data),
    browse: (typeKey: string, limit = 100) => api.get<NodeList>(`${base}/browse`, { params: { typeKey, limit } }).then((r) => r.data),
    expand: (nodeKey: string, opts: { cursor?: string | null; known?: string[]; limit?: number; hops?: number; edgeTypes?: string[] } = {}) =>
      api
        .get<ExpandResponse>(`${node(nodeKey)}/expand`, {
          params: {
            hops: opts.hops ?? 1,
            cursor: opts.cursor || undefined,
            known: opts.known?.length ? opts.known.join(",") : undefined,
            limit: opts.limit,
            edgeTypes: opts.edgeTypes?.length ? opts.edgeTypes.join(",") : undefined,
          },
        })
        .then((r) => r.data),
    // Depth is optional: left out, the server chooses it.
    impact: (nodeKey: string, direction: ImpactDirection, depth?: number) =>
      api.get<ImpactResponse>(`${node(nodeKey)}/impact`, { params: { direction, depth } }).then((r) => r.data),
    detail: (nodeKey: string) => api.get<NodeDetail>(node(nodeKey)).then((r) => r.data),
    fields: (apiName: string) => api.get<ObjectFields>(`${base}/objects/${encodeURIComponent(apiName)}/fields`).then((r) => r.data),
    sharing: (apiName: string) => api.get<SharingSettings>(`${base}/objects/${encodeURIComponent(apiName)}/sharing`).then((r) => r.data),
    recordCounts: (names: string[]) => api.get<RecordCounts>(`${base}/record-counts`, { params: { objects: names.join(",") } }).then((r) => r.data),
    records: (objectApiName: string, q = "") =>
      api.get<{ records: RecordSummary[] }>(`${base}/objects/${encodeURIComponent(objectApiName)}/records`, { params: { q: q || undefined } }).then((r) => r.data.records),
    recordFragment: (objectApiName: string, recordId: string) =>
      api.get<RecordFragment>(`${base}/objects/${encodeURIComponent(objectApiName)}/records/${encodeURIComponent(recordId)}/fragment`).then((r) => r.data),
    recordSharing: (objectApiName: string, recordId: string) =>
      api.get<RecordSharing>(`${base}/objects/${encodeURIComponent(objectApiName)}/records/${encodeURIComponent(recordId)}/sharing`).then((r) => r.data),
    connections: (nodeKey: string, query: ConnectionsQuery) =>
      api
        .get<ConnectionPage>(`${node(nodeKey)}/connections`, {
          params: { direction: query.direction, edgeTypeKey: query.edgeTypeKey, pageSize: query.pageSize, cursor: query.cursor || undefined, q: query.q || undefined },
        })
        .then((r) => r.data),
    relationshipFields: (nodeKey: string) => api.get<{ fields: RelationshipField[] }>(`${node(nodeKey)}/relationship-fields`).then((r) => r.data.fields),
    // The org's instance URL, resolved on demand for "Open in Salesforce" when the page does not hold it yet.
    instanceUrl: () => api.get<{ instanceUrl?: string | null }>(`/connections/${connectionId}`).then((r) => r.data.instanceUrl ?? null),
    intelligence: (nodeKey: string) => api.get<NodeIntelligence>(`${node(nodeKey)}/intelligence`).then((r) => r.data),
  };
}

export type GraphApi = ReturnType<typeof graphApi>;
