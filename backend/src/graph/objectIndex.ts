import { keyOf } from "./draft";

export type ObjectRef = { name: string; nodeKey: string };

// Salesforce record Ids are 15 (case-sensitive) or 18 characters (15 + a 3-character case checksum).
// Both forms identify the same record, so Ids are compared on their first 15 characters.
const SF_ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

export function normaliseSfId(id: string): string {
  return id.slice(0, 15);
}

// The objects in scope for this scan. Salesforce API names are case-insensitive, but Apex source,
// trigger headers and metadata name the same object with different casing; resolving through the
// index always yields the canonical API name. An object that is not in scope resolves to null, so
// no scanner emits an edge toward a node that does not exist. Custom objects are also reachable by
// their Id, because TableEnumOrId and process definitions carry an Id instead of a name for them.
export class ObjectIndex {
  private readonly byLower = new Map<string, ObjectRef>();
  private readonly byId = new Map<string, ObjectRef>();

  constructor(objects: Iterable<{ name: string; sfId?: string | null }>) {
    for (const { name, sfId } of objects) {
      const lower = name.toLowerCase();
      let ref = this.byLower.get(lower);
      if (!ref) {
        ref = { name, nodeKey: keyOf("CustomObject", name) };
        this.byLower.set(lower, ref);
      }
      if (sfId && SF_ID_PATTERN.test(sfId)) this.byId.set(normaliseSfId(sfId), ref);
    }
  }

  // Resolves an API name, or a record Id, to the in-scope object it identifies.
  resolve(nameOrId: string | null | undefined): ObjectRef | null {
    if (!nameOrId) return null;
    const byName = this.byLower.get(nameOrId.toLowerCase());
    if (byName) return byName;
    return SF_ID_PATTERN.test(nameOrId) ? (this.byId.get(normaliseSfId(nameOrId)) ?? null) : null;
  }

  get size(): number {
    return this.byLower.size;
  }

  names(): string[] {
    return [...this.byLower.values()].map((o) => o.name);
  }
}
