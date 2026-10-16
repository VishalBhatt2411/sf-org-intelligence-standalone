import type { RecordEdge, RecordNode } from "./graphApi";
import type { ObjectConnector, ObjectRef, ObjectRelationshipView } from "./objectRelationshipView";

// Record analyze mode's presentation transform: the Record-mode sibling of buildObjectRelationshipView. It
// produces the identical { rootObject, incoming, outgoing, self, counts } shape from a record fragment, so
// the one canvas renders both modes through the same lane layout. Port of the native recordRelationshipView.
// Never calls the server and never mutates its input.
//
// Limitation (same as native): a record connector has no field breakdown and no System/Business
// classification, so every one reads as "Related Record" (or "N Related Records") and the canvas hides the visibility toggle.

export const RECORD_PARENT_EDGE = "SalesforceRecord.LOOKUP_TO";
export const RECORD_CHILD_EDGE = "SalesforceRecord.CHILD_OF";

const recordRef = (node: RecordNode): ObjectRef => ({
  nodeKey: node.nodeKey,
  label: node.label,
  fqn: node.objectApiName,
  isCustom: false,
  secondaryKey: node.objectApiName,
  objectApiName: node.objectApiName,
  recordId: node.recordId,
});

type Group = { referencerKey: string; referencedKey: string; edgeCount: number };

export function buildRecordRelationshipView(nodes: readonly RecordNode[], edges: readonly RecordEdge[], centerNodeKey: string | null): ObjectRelationshipView {
  const nodeByKey = new Map(nodes.map((n) => [n.nodeKey, n]));
  const center = centerNodeKey ? nodeByKey.get(centerNodeKey) : undefined;

  // CHILD_OF is stored centre -> child but reads "the target references the source", the inverse of
  // LOOKUP_TO, so each edge is first resolved to a uniform (referencer, referenced) pair.
  const groups = new Map<string, Group>();
  for (const e of edges) {
    if (e.typeKey !== RECORD_PARENT_EDGE && e.typeKey !== RECORD_CHILD_EDGE) continue;
    const referencerKey = e.typeKey === RECORD_PARENT_EDGE ? e.source : e.target;
    const referencedKey = e.typeKey === RECORD_PARENT_EDGE ? e.target : e.source;
    if (referencerKey !== centerNodeKey && referencedKey !== centerNodeKey) continue;
    if (!nodeByKey.has(referencerKey) || !nodeByKey.has(referencedKey)) continue;
    const key = `${referencerKey}::${referencedKey}`;
    const group = groups.get(key) ?? { referencerKey, referencedKey, edgeCount: 0 };
    group.edgeCount += 1;
    groups.set(key, group);
  }

  const incoming: ObjectConnector[] = [];
  const outgoing: ObjectConnector[] = [];
  const self: ObjectConnector[] = [];
  for (const group of groups.values()) {
    const counterpart = nodeByKey.get(group.referencerKey === centerNodeKey ? group.referencedKey : group.referencerKey);
    if (!counterpart || !center) continue;
    const structural = group.referencerKey === centerNodeKey ? "outgoing" : "incoming";
    // A counterpart of the same object as the centre is "self": two distinct records of one object.
    const direction = counterpart.typeKey === center.typeKey ? "self" : structural;
    const connector: ObjectConnector = {
      connectorKey: `${direction}::${counterpart.nodeKey}`,
      counterpartObject: recordRef(counterpart),
      direction,
      fields: [],
      relationshipCount: group.edgeCount,
      primaryRelationshipType: "Lookup",
      isSystemRelationship: false,
      labelOverride: group.edgeCount > 1 ? `${group.edgeCount} Related Records` : "Related Record",
    };
    (direction === "self" ? self : direction === "outgoing" ? outgoing : incoming).push(connector);
  }

  return {
    rootObject: center ? recordRef(center) : null,
    incomingRelationships: sortConnectors(incoming),
    outgoingRelationships: sortConnectors(outgoing),
    selfRelationships: sortConnectors(self),
    counts: { incomingTotal: incoming.length, outgoingTotal: outgoing.length, selfTotal: self.length },
  };
}

const sortConnectors = (connectors: ObjectConnector[]): ObjectConnector[] => connectors.slice().sort((a, b) => a.counterpartObject.label.localeCompare(b.counterpartObject.label));
