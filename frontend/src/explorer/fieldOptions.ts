import type { ExpandResponse, GraphEdge, GraphNode } from "./graphApi";
import { HAS_FIELD_EDGE } from "./objectRelationshipView";

// Pure logic behind the Field-mode picker (port of native oiFieldPicker's option handling).

export const FIELD_PICKER_MAX_ROWS = 12;

export type FieldOption = { nodeKey: string; label: string; apiName: string; node: GraphNode };

const isFull = (n: ExpandResponse["nodes"][number]): n is GraphNode & { ring: number } => !("unchanged" in n);

// The object's own fields from a one-hop expansion: targets of HAS_FIELD edges that start at the object, sorted
// by label so the list reads the same every time.
export function ownFieldOptions(objectKey: string, response: Pick<ExpandResponse, "nodes" | "edges">): FieldOption[] {
  const byKey = new Map<string, GraphNode>();
  for (const n of response.nodes) if (isFull(n)) byKey.set(n.nodeKey, n);
  const seen = new Set<string>();
  const options: FieldOption[] = [];
  for (const edge of response.edges as readonly GraphEdge[]) {
    if (edge.source !== objectKey || edge.typeKey !== HAS_FIELD_EDGE) continue;
    const node = byKey.get(edge.target);
    if (!node || seen.has(node.nodeKey)) continue;
    seen.add(node.nodeKey);
    options.push({ nodeKey: node.nodeKey, label: node.label, apiName: apiNameOf(node), node });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

// "Account.OwnerId" -> "OwnerId"; anything without an object prefix is already the API name.
export function apiNameOf(node: GraphNode): string {
  const i = node.fqn.lastIndexOf(".");
  return i >= 0 ? node.fqn.slice(i + 1) : node.fqn;
}

export type FieldMatches = { rows: FieldOption[]; total: number; filtered: boolean };

// Case-insensitive match on label or API name; the visible list is capped, the total is not.
export function matchFields(options: readonly FieldOption[], text: string, cap = FIELD_PICKER_MAX_ROWS): FieldMatches {
  const needle = text.trim().toLowerCase();
  const hits = needle ? options.filter((o) => o.label.toLowerCase().includes(needle) || o.apiName.toLowerCase().includes(needle)) : [...options];
  return { rows: hits.slice(0, cap), total: hits.length, filtered: needle.length > 0 };
}

export function countLabel(m: FieldMatches): string {
  if (m.filtered) return `${m.total} ${m.total === 1 ? "match" : "matches"}`;
  return `${m.total} ${m.total === 1 ? "field" : "fields"}`;
}
