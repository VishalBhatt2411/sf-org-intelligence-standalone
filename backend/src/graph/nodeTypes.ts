import { typeKeyOf } from "./keys";
import type { Confidence } from "./types";

// Static registry of node and edge kinds. In the Salesforce original this lived in custom metadata;
// here it is code, because it is presentation and traversal policy, not per-customer configuration.
// Colours and icons are deliberately not here — the UI maps kinds onto the app theme.

export type NodeCategory = "structure" | "code" | "automation" | "security";

export const NODE_KINDS = {
  CustomObject: { label: "Object", categories: ["structure"] },
  CustomField: { label: "Field", categories: ["structure"] },
  ApexClass: { label: "Apex Class", categories: ["code"] },
  ApexTrigger: { label: "Apex Trigger", categories: ["automation", "code"] },
  Flow: { label: "Flow", categories: ["automation"] },
  ApprovalProcess: { label: "Approval Process", categories: ["automation"] },
  EmailAlert: { label: "Email Alert", categories: ["automation"] },
  ValidationRule: { label: "Validation Rule", categories: ["automation"] },
  WorkflowRule: { label: "Workflow Rule", categories: ["automation"] },
  PermissionSet: { label: "Permission Set", categories: ["security"] },
  SharingRule: { label: "Sharing Rule", categories: ["security"] },
} as const satisfies Record<string, { label: string; categories: readonly NodeCategory[] }>;

export type NodeKind = keyof typeof NODE_KINDS;

export type EdgeLineStyle = "solid" | "dashed" | "dotted";

type EdgeKindInfo = {
  style: EdgeLineStyle;
  // Role label read from the source node, and from the target node.
  sourceRole: string;
  targetRole: string;
  defaultConfidence: Confidence;
  // Whether impact analysis follows this edge. Structural edges are not impact.
  followedByImpact: boolean;
};

export const EDGE_KINDS = {
  HAS_FIELD: { style: "solid", sourceRole: "Has Field", targetRole: "Field Of", defaultConfidence: "exact", followedByImpact: false },
  LOOKUP_TO: { style: "dashed", sourceRole: "References", targetRole: "Referenced By", defaultConfidence: "exact", followedByImpact: false },
  MASTER_DETAIL_TO: { style: "solid", sourceRole: "Child Of", targetRole: "Parent Of", defaultConfidence: "exact", followedByImpact: false },
  EXECUTES_ON: { style: "solid", sourceRole: "Executes On", targetRole: "Runs On", defaultConfidence: "exact", followedByImpact: true },
  APPLIES_TO: { style: "solid", sourceRole: "Applies To", targetRole: "Has Approval Process", defaultConfidence: "exact", followedByImpact: false },
  VALIDATES: { style: "solid", sourceRole: "Validates", targetRole: "Validated By", defaultConfidence: "exact", followedByImpact: false },
  GRANTS_ACCESS_TO: { style: "dashed", sourceRole: "Grants Access To", targetRole: "Access Granted", defaultConfidence: "exact", followedByImpact: true },
  REFERENCES: { style: "dotted", sourceRole: "References", targetRole: "Referenced By", defaultConfidence: "heuristic", followedByImpact: true },
  // New in the standalone app: component-to-component and component-to-field dependencies read from
  // Tooling MetadataComponentDependency (the Apex original never built field-impact edges).
  DEPENDS_ON: { style: "dashed", sourceRole: "Depends On", targetRole: "Depended On By", defaultConfidence: "exact", followedByImpact: true },
} as const satisfies Record<string, EdgeKindInfo>;

export type EdgeKind = keyof typeof EDGE_KINDS;

export const nodeTypeKey = (kind: NodeKind): string => typeKeyOf(kind);
export const edgeTypeKey = (kind: EdgeKind): string => typeKeyOf(kind);

export function isNodeKind(kind: string): kind is NodeKind {
  return Object.prototype.hasOwnProperty.call(NODE_KINDS, kind);
}

export function isEdgeKind(kind: string): kind is EdgeKind {
  return Object.prototype.hasOwnProperty.call(EDGE_KINDS, kind);
}

export function nodeKindInfo(typeKey: string): { kind: NodeKind; label: string; categories: readonly NodeCategory[] } | null {
  const kind = typeKey.replace(/^SalesforceMetadata\./, "");
  return isNodeKind(kind) ? { kind, ...NODE_KINDS[kind] } : null;
}

export function edgeKindInfo(typeKey: string): ({ kind: EdgeKind } & EdgeKindInfo) | null {
  const kind = typeKey.replace(/^SalesforceMetadata\./, "");
  return isEdgeKind(kind) ? { kind, ...EDGE_KINDS[kind] } : null;
}

// Edge type keys that impact analysis follows (REFERENCES, EXECUTES_ON, GRANTS_ACCESS_TO, DEPENDS_ON).
export const IMPACT_EDGE_TYPE_KEYS: readonly string[] = (Object.keys(EDGE_KINDS) as EdgeKind[])
  .filter((k) => EDGE_KINDS[k].followedByImpact)
  .map(edgeTypeKey);

export const ALL_EDGE_TYPE_KEYS: readonly string[] = (Object.keys(EDGE_KINDS) as EdgeKind[]).map(edgeTypeKey);
