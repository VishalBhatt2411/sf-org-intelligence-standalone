// Shared graph vocabulary. Scanners produce drafts; only the graph builder turns drafts into rows.

export type Confidence = "exact" | "parsed" | "heuristic";
export type GraphState = "active" | "stale";
export type Coverage = "complete" | "partial" | "degraded";

export type NodeDraft = {
  typeKey: string;
  namespace: string | null;
  fqn: string;
  label: string;
  // Node key of the parent (a field's parent is its object); null for top-level components.
  parentKey: string | null;
  attributes: Record<string, unknown>;
};

export type EdgeDraft = {
  typeKey: string;
  sourceNodeKey: string;
  targetNodeKey: string;
  confidence: Confidence;
  attributes: Record<string, unknown>;
};

// What a pure scanner returns. `ids` maps Salesforce record Ids to node keys so the dependency
// stage can resolve MetadataComponentDependency endpoints without guessing at names.
export type ScannerOutput = {
  nodes: NodeDraft[];
  edges: EdgeDraft[];
  ids: Array<[sfId: string, nodeKey: string]>;
};

export const emptyOutput = (): ScannerOutput => ({ nodes: [], edges: [], ids: [] });

// Edges are retired per (edge type, source node type): "REFERENCES from Apex classes" is owned by the
// class stage, "REFERENCES from Apex triggers" by the trigger stage. A null source type means any.
export type EdgeScope = { typeKey: string; sourceTypeKey: string | null };
