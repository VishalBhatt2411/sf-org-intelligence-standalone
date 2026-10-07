import { sha256Hex } from "./keys";
import type { EdgeDraft, NodeDraft } from "./types";

// Deterministic JSON: object keys sorted, so the same value always serialises the same way.
export function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalAttributes(attributes: Record<string, unknown>): string {
  return Object.keys(attributes)
    .sort()
    .map((k) => {
      const v = attributes[k];
      if (v === null || v === undefined) return `${k}=`;
      return `${k}=${typeof v === "object" ? stableJson(v) : String(v)}`;
    })
    .join(";");
}

// Anything a user can see on a node feeds its checksum, so a change to any of it is detected on the
// next scan and nothing else is rewritten.
export function nodeChecksum(draft: NodeDraft): string {
  return sha256Hex(
    ["node", draft.typeKey, draft.namespace ?? "", draft.fqn, draft.label, draft.parentKey ?? "", canonicalAttributes(draft.attributes)].join("|")
  );
}

// Unlike the Apex original (which passed a null edge checksum, so changed edge attributes were never
// picked up), edge attributes and confidence are part of the checksum.
export function edgeChecksum(draft: EdgeDraft): string {
  return sha256Hex(
    ["edge", draft.typeKey, draft.sourceNodeKey, draft.targetNodeKey, draft.confidence, canonicalAttributes(draft.attributes)].join("|")
  );
}
