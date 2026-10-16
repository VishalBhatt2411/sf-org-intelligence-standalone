import { dedupeEdges, edgeDraft, nodeDraft } from "../draft";
import type { ObjectIndex } from "../objectIndex";
import { namespaceFromApiName } from "../keys";
import { isRelationshipFieldCandidate } from "../scope";
import { emptyOutput, type ScannerOutput } from "../types";
import type { DescribedObject, ObjectInput } from "./inputs";

// Objects: one node per in-scope object. Scope is decided by the caller (see scope.ts); this
// function only turns the survivors into nodes. Attributes follow the native OI_ObjectScanner set;
// namespace is reported for custom objects only, as there.
export function scanObjects(objects: ObjectInput[]): ScannerOutput {
  const out = emptyOutput();
  for (const object of objects) {
    const custom = object.apiName.endsWith("__c");
    const { key, draft } = nodeDraft("CustomObject", {
      fqn: object.apiName,
      label: object.label || object.apiName,
      attributes: {
        label: object.label,
        custom,
        ...(object.details ?? {}),
        namespace: custom ? namespaceFromApiName(object.apiName) : null,
        durableId: object.sfId,
      },
    });
    out.nodes.push(draft);
    if (object.sfId) out.ids.push([object.sfId, key]);
  }
  return out;
}

// Relationship fields only. A lookup or master-detail is what links two objects, so it is the one
// kind of field worth a node of its own; plain fields join the graph on demand when a dependency
// points at them (dependencies.ts). System audit lookups (OwnerId, CreatedById, LastModifiedById) are
// kept, as in the native app. A relationship whose targets are all out of scope is skipped: it would
// be a field node with nothing to connect to. `fieldInScope` drops fields of other managed packages
// (scope.ts isFieldNamespaceInScope); every field is kept when it is omitted.
export function scanRelationshipFields(described: DescribedObject[], index: ObjectIndex, fieldInScope: (fieldName: string) => boolean = () => true): ScannerOutput {
  const out = emptyOutput();
  for (const object of described) {
    const owner = index.resolve(object.name);
    if (!owner) continue;
    for (const field of object.fields) {
      if (!isRelationshipFieldCandidate(field)) continue;
      if (!fieldInScope(field.name)) continue;
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
        // Native parity: referenceTo keeps every target the field can point at, out-of-scope ones included
        // (they just get no edge), plus the full describe attribute set.
        attributes: {
          label: field.label,
          type: field.type,
          relationship,
          masterDetail: field.masterDetail,
          custom: field.custom ?? field.name.endsWith("__c"),
          relationshipName: field.relationshipName ?? null,
          referenceTo: [...(field.referenceTo ?? [])].sort(),
          ...(field.details ?? {}),
          // The Tooling CustomField Id (custom fields only), as the native durableId.
          durableId: field.sfId,
        },
      });
      out.nodes.push(draft);
      if (field.sfId) out.ids.push([field.sfId, key]);
      out.edges.push(edgeDraft("HAS_FIELD", owner.nodeKey, key));
      for (const targetKey of targets.values()) {
        out.edges.push(edgeDraft(field.masterDetail ? "MASTER_DETAIL_TO" : "LOOKUP_TO", key, targetKey, { attributes: { relationshipName: field.relationshipName ?? null } }));
      }
    }
  }
  out.edges = dedupeEdges(out.edges);
  return out;
}
