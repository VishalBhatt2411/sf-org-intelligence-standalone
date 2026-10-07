import { dedupeEdges, edgeDraft, keyOf, nodeDraft } from "../draft";
import { normaliseSfId, type ObjectIndex } from "../objectIndex";
import { emptyOutput, type ScannerOutput } from "../types";
import type { DependencyInput, StoredFieldInfo } from "./inputs";

export type DependencyOutput = ScannerOutput & { unresolved: number };

export type DependencyContext = {
  // Salesforce Id (any length) -> node key, accumulated from the earlier stages' `ids`.
  idToKey: ReadonlyMap<string, string>;
  // Every node key the earlier stages emitted, so a field they already built is not built twice.
  knownKeys: ReadonlySet<string>;
  // Stored fields by Id, to place a field-level dependency under the right object.
  fieldBySfId: ReadonlyMap<string, StoredFieldInfo>;
  index: ObjectIndex;
};

type Endpoint = { key: string; parentKey: string | null };

// DEPENDS_ON edges from Tooling MetadataComponentDependency: "the source cannot work without the
// target". Endpoints are resolved by Salesforce Id first (exact, from the stages that built the
// nodes), and only by name for objects, which the platform names rather than Ids for standard ones.
// A plain field only becomes a node here, when something depends on it; that is how field-level
// impact analysis works without storing every field of the org. An endpoint that cannot be resolved
// (a component type the graph has no node for, an out-of-scope object) is counted and skipped,
// never guessed at.
export function scanDependencies(deps: DependencyInput[], context: DependencyContext): DependencyOutput {
  const out: DependencyOutput = { ...emptyOutput(), unresolved: 0 };
  const materialised = new Set<string>();

  const resolve = (id: string, name: string, type: string): Endpoint | null => {
    const field = type === "CustomField" ? context.fieldBySfId.get(normaliseSfId(id)) : undefined;
    if (field) {
      const owner = context.index.resolve(field.objectName);
      if (!owner) return null;
      const fqn = `${owner.name}.${field.fieldName}`;
      const key = keyOf("CustomField", fqn);
      if (!context.knownKeys.has(key) && !materialised.has(key)) {
        materialised.add(key);
        const { draft } = nodeDraft("CustomField", { fqn, label: field.label || field.fieldName, parentKey: owner.nodeKey, attributes: { label: field.label, type: field.type } });
        out.nodes.push(draft);
        out.edges.push(edgeDraft("HAS_FIELD", owner.nodeKey, key));
      }
      return { key, parentKey: owner.nodeKey };
    }
    const byId = context.idToKey.get(normaliseSfId(id));
    if (byId) return { key: byId, parentKey: null };
    if (type === "StandardEntity" || type === "CustomObject") {
      const object = context.index.resolve(name);
      if (object) return { key: object.nodeKey, parentKey: null };
    }
    return null;
  };

  for (const dep of deps) {
    const source = resolve(dep.componentId, dep.componentName, dep.componentType);
    const target = resolve(dep.refComponentId, dep.refComponentName, dep.refComponentType);
    if (!source || !target) {
      out.unresolved++;
      continue;
    }
    // A component trivially "depends on" itself, and a field on its own object; the second is the
    // HAS_FIELD edge already, so it carries no information as an impact edge.
    if (source.key === target.key || source.parentKey === target.key) continue;
    out.edges.push(edgeDraft("DEPENDS_ON", source.key, target.key, { attributes: { sourceType: dep.componentType, targetType: dep.refComponentType } }));
  }
  out.edges = dedupeEdges(out.edges);
  return out;
}
