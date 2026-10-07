import { dedupeEdges, edgeDraft, nodeDraft } from "../draft";
import type { ObjectIndex } from "../objectIndex";
import { isRelationshipFieldCandidate } from "../scope";
import { emptyOutput, type ScannerOutput } from "../types";
import type { DescribedObject, ObjectInput } from "./inputs";

// Objects: one node per in-scope object. Scope is decided by the caller (see scope.ts); this
// function only turns the survivors into nodes.
export function scanObjects(objects: ObjectInput[]): ScannerOutput {
  const out = emptyOutput();
  for (const object of objects) {
    const { key, draft } = nodeDraft("CustomObject", {
      fqn: object.apiName,
      label: object.label || object.apiName,
      attributes: { label: object.label, custom: object.apiName.endsWith("__c") },
    });
    out.nodes.push(draft);
    if (object.sfId) out.ids.push([object.sfId, key]);
  }
  return out;
}

// Relationship fields only. A lookup or master-detail is what links two objects, so it is the one
// kind of field worth a node of its own; plain fields join the graph on demand when a dependency
// points at them (dependencies.ts). A relationship whose targets are all out of scope is skipped:
// it would be a field node with nothing to connect to.
export function scanRelationshipFields(described: DescribedObject[], index: ObjectIndex): ScannerOutput {
  const out = emptyOutput();
  for (const object of described) {
    const owner = index.resolve(object.name);
    if (!owner) continue;
    for (const field of object.fields) {
      if (!isRelationshipFieldCandidate(field)) continue;
      const targets = new Map<string, string>();
      for (const target of field.referenceTo ?? []) {
        const resolved = index.resolve(target);
        if (resolved) targets.set(resolved.name, resolved.nodeKey);
      }
      if (targets.size === 0) continue;

      const relationship = field.masterDetail ? "MasterDetail" : "Lookup";
      const { key, draft } = nodeDraft("CustomField", {
        fqn: `${owner.name}.${field.name}`,
        label: field.label || field.name,
        parentKey: owner.nodeKey,
        attributes: { label: field.label, type: field.type, relationship, referenceTo: [...targets.keys()].sort() },
      });
      out.nodes.push(draft);
      if (field.sfId) out.ids.push([field.sfId, key]);
      out.edges.push(edgeDraft("HAS_FIELD", owner.nodeKey, key));
      for (const targetKey of targets.values()) {
        out.edges.push(edgeDraft(field.masterDetail ? "MASTER_DETAIL_TO" : "LOOKUP_TO", key, targetKey));
      }
    }
  }
  out.edges = dedupeEdges(out.edges);
  return out;
}
