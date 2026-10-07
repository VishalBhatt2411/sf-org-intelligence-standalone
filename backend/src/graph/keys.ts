import { createHash } from "crypto";

export const NODE_TYPE_PREFIX = "SalesforceMetadata.";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function typeKeyOf(kind: string): string {
  return NODE_TYPE_PREFIX + kind;
}

export function kindOfTypeKey(typeKey: string): string {
  return typeKey.startsWith(NODE_TYPE_PREFIX) ? typeKey.slice(NODE_TYPE_PREFIX.length) : typeKey;
}

// Stable identity of a node across scans: the same component always hashes to the same key,
// whatever its attributes are. A null namespace and an empty one are the same namespace.
export function nodeKey(typeKey: string, namespace: string | null | undefined, fqn: string): string {
  return sha256Hex(`${typeKey}::${namespace ?? ""}::${fqn}`);
}

export function nodeKeyFor(kind: string, namespace: string | null | undefined, fqn: string): string {
  return nodeKey(typeKeyOf(kind), namespace, fqn);
}

// Edges are directed and keyed by their endpoints' logical node keys, never by row ids.
export function edgeKey(sourceNodeKey: string, edgeTypeKey: string, targetNodeKey: string): string {
  return sha256Hex(`${sourceNodeKey}::${edgeTypeKey}::${targetNodeKey}`);
}

// Human-readable component key "kind::namespace::fqn". The fqn is the remainder, so it may itself
// contain "::" without being cut short.
export function componentKey(kind: string, namespace: string | null | undefined, fqn: string): string {
  return `${kind}::${namespace ?? ""}::${fqn}`;
}

export function parseComponentKey(key: string): { kind: string; namespace: string | null; fqn: string } | null {
  const first = key.indexOf("::");
  if (first < 0) return null;
  const second = key.indexOf("::", first + 2);
  if (second < 0) return null;
  const kind = key.slice(0, first);
  const fqn = key.slice(second + 2);
  if (!kind || !fqn) return null;
  const namespace = key.slice(first + 2, second);
  return { kind, namespace: namespace || null, fqn };
}

// A namespaced API name has three or more "__"-separated segments (ns__Name__c); the first is the
// namespace. "Name__c" and standard names have none. Trailing empty segments are ignored, like Apex split().
export function namespaceFromApiName(apiName: string | null | undefined): string | null {
  if (!apiName) return null;
  const segments = apiName.split("__");
  while (segments.length > 0 && segments[segments.length - 1] === "") segments.pop();
  return segments.length >= 3 && segments[0] ? segments[0] : null;
}
