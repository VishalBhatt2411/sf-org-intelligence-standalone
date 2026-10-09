import type { GraphEdge, GraphNode } from "./graphApi";

// Object analyze mode's presentation transform: derives the directional object-to-object relationships
// (incoming, outgoing, self) around one centred object from nodes and edges the client already holds.
// Port of the native objectRelationshipView module. It never calls the server and never mutates its input.
//
// Each (Object)-HAS_FIELD->(Field)-LOOKUP_TO|MASTER_DETAIL_TO->(Object) chain becomes one direct
// object-to-object relationship, and several fields between the same pair share one connector.
// Centre-anchored on purpose: a relationship between two non-centre objects that both happen to be loaded
// is left out, because this view answers "what does this object relate to". A relationship whose field or
// either end object is not in the node set is skipped, never an error.

export const OBJECT_TYPE_KEY = "SalesforceMetadata.CustomObject";
export const FIELD_TYPE_KEY = "SalesforceMetadata.CustomField";
export const HAS_FIELD_EDGE = "SalesforceMetadata.HAS_FIELD";
export const LOOKUP_TO_EDGE = "SalesforceMetadata.LOOKUP_TO";
export const MASTER_DETAIL_TO_EDGE = "SalesforceMetadata.MASTER_DETAIL_TO";
// The edge types Object mode asks the server to follow.
export const OBJECT_MODE_EDGE_TYPES = [HAS_FIELD_EDGE, LOOKUP_TO_EDGE, MASTER_DETAIL_TO_EDGE] as const;

// The platform's universal audit fields: present on effectively every object, so a relationship through
// them is "system" noise by default. Exact match only; a custom field cannot be named exactly like these.
export const SYSTEM_FIELD_API_NAMES: ReadonlySet<string> = new Set(["OwnerId", "CreatedById", "LastModifiedById"]);

// Connectors shown per lane before "Show N more".
export const DEFAULT_VISIBLE_PER_LANE = 6;

export type RelationshipType = "Lookup" | "MasterDetail";
export type ConnectorDirection = "incoming" | "outgoing" | "self";

export type ObjectRef = { nodeKey: string; label: string; fqn: string; isCustom: boolean };

export type ConnectorField = {
  fieldNodeKey: string;
  // "Object.Field", carried so the detail dialog can name the field without another lookup.
  fieldFqn: string | null;
  fieldApiName: string | null;
  relationshipType: RelationshipType;
  isSystemRelationship: boolean;
};

export type ObjectConnector = {
  connectorKey: string;
  counterpartObject: ObjectRef;
  direction: ConnectorDirection;
  fields: ConnectorField[];
  relationshipCount: number;
  primaryRelationshipType: RelationshipType;
  isSystemRelationship: boolean;
};

export type ObjectRelationshipView = {
  rootObject: ObjectRef | null;
  incomingRelationships: ObjectConnector[];
  outgoingRelationships: ObjectConnector[];
  selfRelationships: ObjectConnector[];
  counts: { incomingTotal: number; outgoingTotal: number; selfTotal: number };
};

export const isSystemField = (fieldApiName: string | null | undefined): boolean => !!fieldApiName && SYSTEM_FIELD_API_NAMES.has(fieldApiName);

export const isCustomApiName = (apiName: string | null | undefined): boolean => !!apiName && apiName.endsWith("__c");

// "Account.OwnerId" -> "OwnerId". Falls back to the raw value when there is no dot rather than guessing.
function deriveFieldApiName(fieldFqn: string | null): string | null {
  if (!fieldFqn) return null;
  const dot = fieldFqn.indexOf(".");
  return dot === -1 ? fieldFqn : fieldFqn.slice(dot + 1);
}

function objectRef(node: GraphNode): ObjectRef {
  const custom = node.attributes?.custom;
  return { nodeKey: node.nodeKey, label: node.label, fqn: node.fqn, isCustom: typeof custom === "boolean" ? custom : isCustomApiName(node.fqn) };
}

type Group = { ownerKey: string; referencedKey: string; direction: ConnectorDirection; fields: ConnectorField[] };

export function buildObjectRelationshipView(nodes: readonly GraphNode[], edges: readonly GraphEdge[], centerNodeKey: string | null): ObjectRelationshipView {
  const nodeByKey = new Map(nodes.map((n) => [n.nodeKey, n]));
  const objects = new Map(nodes.filter((n) => n.typeKey === OBJECT_TYPE_KEY).map((n) => [n.nodeKey, n]));

  // fieldKey -> owning object, from every HAS_FIELD edge that starts at an object in the set.
  const ownerOf = new Map<string, string>();
  for (const e of edges) if (e.typeKey === HAS_FIELD_EDGE && objects.has(e.source)) ownerOf.set(e.target, e.source);

  const groups = new Map<string, Group>();
  for (const e of edges) {
    if (e.typeKey !== LOOKUP_TO_EDGE && e.typeKey !== MASTER_DETAIL_TO_EDGE) continue;
    const owner = ownerOf.get(e.source);
    const referenced = e.target;
    if (!owner || !objects.has(owner) || !objects.has(referenced)) continue;
    if (owner !== centerNodeKey && referenced !== centerNodeKey) continue;
    const groupKey = `${owner}::${referenced}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { ownerKey: owner, referencedKey: referenced, direction: owner === referenced ? "self" : owner === centerNodeKey ? "outgoing" : "incoming", fields: [] };
      groups.set(groupKey, group);
    }
    // The field's own name comes from the field node's full name, not from the edge, so the system-field
    // check below always sees a real field API name.
    const fieldFqn = nodeByKey.get(e.source)?.fqn ?? null;
    const fieldApiName = deriveFieldApiName(fieldFqn);
    group.fields.push({
      fieldNodeKey: e.source,
      fieldFqn,
      fieldApiName,
      relationshipType: e.typeKey === MASTER_DETAIL_TO_EDGE ? "MasterDetail" : "Lookup",
      isSystemRelationship: isSystemField(fieldApiName),
    });
  }

  const incoming: ObjectConnector[] = [];
  const outgoing: ObjectConnector[] = [];
  const self: ObjectConnector[] = [];
  for (const group of groups.values()) {
    const counterpartKey = group.direction === "outgoing" ? group.referencedKey : group.ownerKey;
    const counterpart = objects.get(counterpartKey);
    if (!counterpart) continue;
    const fields = group.fields.slice().sort((a, b) => (a.fieldApiName ?? "").localeCompare(b.fieldApiName ?? ""));
    const connector: ObjectConnector = {
      connectorKey: `${group.direction}::${counterpart.nodeKey}`,
      counterpartObject: objectRef(counterpart),
      direction: group.direction,
      fields,
      relationshipCount: fields.length,
      primaryRelationshipType: fields.some((f) => f.relationshipType === "MasterDetail") ? "MasterDetail" : "Lookup",
      // System only when every field is; one business field keeps the connector visible by default.
      isSystemRelationship: fields.length > 0 && fields.every((f) => f.isSystemRelationship),
    };
    (group.direction === "self" ? self : group.direction === "outgoing" ? outgoing : incoming).push(connector);
  }

  const root = centerNodeKey ? nodeByKey.get(centerNodeKey) : undefined;
  return {
    rootObject: root ? objectRef(root) : null,
    incomingRelationships: sortConnectors(incoming),
    outgoingRelationships: sortConnectors(outgoing),
    selfRelationships: sortConnectors(self),
    counts: { incomingTotal: incoming.length, outgoingTotal: outgoing.length, selfTotal: self.length },
  };
}

// Most fields first, then by name, so the busiest relationships are always in the first six.
function sortConnectors(connectors: ObjectConnector[]): ObjectConnector[] {
  return connectors.slice().sort((a, b) => b.relationshipCount - a.relationshipCount || a.counterpartObject.label.localeCompare(b.counterpartObject.label));
}

export type VisibilityMode = "business" | "system" | "all";

// Business hides connectors that are system-only, System shows only those, All shows everything.
export function filterByVisibility(connectors: readonly ObjectConnector[], mode: VisibilityMode): ObjectConnector[] {
  if (mode === "all") return connectors.slice();
  return connectors.filter((c) => (mode === "system" ? c.isSystemRelationship : !c.isSystemRelationship));
}
