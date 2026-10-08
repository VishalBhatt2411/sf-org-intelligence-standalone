import type { StoredEdge, StoredNode } from "./graphReadRepository";
import { kindOfTypeKey } from "./keys";
import { edgeKindInfo, nodeKindInfo } from "./nodeTypes";
import type { Confidence } from "./types";

// Wire shapes the read services return. Presentation facts (kind label, categories, line style) come
// from the static registry in nodeTypes.ts; colours and icons are the UI's business.

export type NodeDto = {
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

export type EdgeDto = {
  edgeKey: string;
  typeKey: string;
  kind: string;
  style: "solid" | "dashed" | "dotted";
  sourceRole: string;
  targetRole: string;
  source: string;
  target: string;
  confidence: Confidence;
  // The field the relationship goes through, when one end is a field and the other is not.
  viaField: string | null;
  attributes: Record<string, unknown>;
};

export function toNodeDto(node: StoredNode): NodeDto {
  const info = nodeKindInfo(node.typeKey);
  return {
    nodeKey: node.nodeKey,
    typeKey: node.typeKey,
    kind: info?.kind ?? kindOfTypeKey(node.typeKey),
    kindLabel: info?.label ?? kindOfTypeKey(node.typeKey),
    categories: info ? [...info.categories] : [],
    label: node.label,
    fqn: node.fqn,
    namespace: node.namespace,
    parentKey: node.parentKey,
    checksum: node.checksum,
    attributes: node.attributes,
  };
}

const isField = (node: StoredNode | undefined): node is StoredNode => node?.typeKey === "SalesforceMetadata.CustomField";

// `nodes` only has to contain the edge's endpoints; viaField is null when either is missing.
export function toEdgeDto(edge: StoredEdge, nodes: ReadonlyMap<string, StoredNode>): EdgeDto {
  const info = edgeKindInfo(edge.typeKey);
  const source = nodes.get(edge.sourceNodeKey);
  const target = nodes.get(edge.targetNodeKey);
  let viaField: string | null = null;
  if (info && info.kind !== "HAS_FIELD" && source && target) {
    if (isField(source) && !isField(target)) viaField = source.fqn;
    else if (isField(target) && !isField(source)) viaField = target.fqn;
  }
  return {
    edgeKey: edge.edgeKey,
    typeKey: edge.typeKey,
    kind: info?.kind ?? kindOfTypeKey(edge.typeKey),
    style: info?.style ?? "solid",
    sourceRole: info?.sourceRole ?? "Related To",
    targetRole: info?.targetRole ?? "Related To",
    source: edge.sourceNodeKey,
    target: edge.targetNodeKey,
    confidence: edge.confidence,
    viaField,
    attributes: edge.attributes,
  };
}

export function indexNodes(nodes: Iterable<StoredNode>): Map<string, StoredNode> {
  return new Map([...nodes].map((n) => [n.nodeKey, n]));
}
