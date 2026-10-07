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
