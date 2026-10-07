import type { Flow, ApexTrigger, SfObject, SfField, ComponentDependency } from "@prisma/client";
import type { NewFinding } from "./codeQuality";

const LARGE_OBJECT_FIELD_COUNT = 200;
const HIGH_COUPLING_LOOKUP_COUNT = 15;
const GOD_COMPONENT_REFERENCER_THRESHOLD = 40;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function analyzeArchitecture(
  objects: SfObject[],
  triggers: ApexTrigger[],
  flows: Flow[],
  fields: SfField[],
  dependencies: ComponentDependency[]
): NewFinding[] {
  const findings: NewFinding[] = [];

  for (const object of objects) {
    if (object.fieldCount > LARGE_OBJECT_FIELD_COUNT) {
      findings.push({
        category: "architecture",
        ruleKey: "large_object",
        severity: "low",
        title: `${object.apiName} has ${object.fieldCount} fields`,
        detail: `Exceeds ${LARGE_OBJECT_FIELD_COUNT} fields, which slows layout rendering and increases confusion.`,
        componentType: "SfObject",
        componentName: object.apiName,
      });
    }
  }

  const triggersByObject = new Map<string, ApexTrigger[]>();
  for (const trigger of triggers) {
    triggersByObject.set(trigger.objectName, [...(triggersByObject.get(trigger.objectName) || []), trigger]);
  }
  for (const [objectName, group] of triggersByObject) {
    if (group.length > 1) {
      findings.push({
        category: "architecture",
        ruleKey: "multiple_triggers",
        severity: "medium",
        title: `${objectName} has ${group.length} triggers`,
        detail: `Multiple triggers on one object (${group.map((t) => t.name).join(", ")}) make execution order implicit.`,
        componentType: "SfObject",
        componentName: objectName,
      });
    }
  }

  const activeFlowObjects = new Set(flows.filter((f) => f.status === "Active" && f.objectName).map((f) => f.objectName!));
  for (const [objectName] of triggersByObject) {
    if (activeFlowObjects.has(objectName)) {
      findings.push({
        category: "architecture",
        ruleKey: "trigger_flow_conflict",
        severity: "medium",
        title: `${objectName} has both a trigger and an active flow`,
        detail: "Both automations can fire on the same DML, risking order-dependent bugs or duplicate logic.",
        componentType: "SfObject",
        componentName: objectName,
      });
    }
  }

  // Data model coupling: build the lookup/master-detail relationship graph from
  // describe()'s referenceTo (captured on SfField during the objects scan).
  const objectApiNameById = new Map(objects.map((o) => [o.id, o.apiName]));
  const outgoingByObject = new Map<string, Set<string>>();
  for (const field of fields) {
    const refs = asStringArray(field.referenceTo);
    if (refs.length === 0) continue;
    const fromObject = objectApiNameById.get(field.objectId);
    if (!fromObject) continue;
    const set = outgoingByObject.get(fromObject) || new Set<string>();
    refs.forEach((r) => set.add(r));
    outgoingByObject.set(fromObject, set);
  }

  for (const [objectName, refs] of outgoingByObject) {
    if (refs.size > HIGH_COUPLING_LOOKUP_COUNT) {
      findings.push({
        category: "architecture",
        ruleKey: "high_coupling_object",
        severity: "medium",
        title: `${objectName} has ${refs.size} outgoing lookup/master-detail relationships`,
        detail: `Exceeds ${HIGH_COUPLING_LOOKUP_COUNT} relationship fields, coupling this object tightly to the rest of the data model and widening the blast radius of schema changes.`,
        componentType: "SfObject",
        componentName: objectName,
      });
    }
  }

  const seenPairs = new Set<string>();
  for (const [objectName, refs] of outgoingByObject) {
    for (const target of refs) {
      if (target === objectName || seenPairs.has([target, objectName].sort().join("::"))) continue;
      if (outgoingByObject.get(target)?.has(objectName)) {
        seenPairs.add([objectName, target].sort().join("::"));
        findings.push({
          category: "architecture",
          ruleKey: "circular_object_reference",
          severity: "low",
          title: `${objectName} and ${target} reference each other`,
          detail: "A circular lookup relationship between these objects complicates data loads, deletes, and sharing calculations.",
          componentType: "SfObject",
          componentName: `${objectName} / ${target}`,
        });
      }
    }
  }

  // Blast radius: a component referenced by an unusually large number of distinct other
  // components — changing it safely requires understanding everywhere it's used.
  const referencersByComponent = new Map<string, Set<string>>();
  const componentMeta = new Map<string, { name: string; type: string }>();
  for (const dep of dependencies) {
    const set = referencersByComponent.get(dep.refComponentId) || new Set<string>();
    set.add(dep.componentId);
    referencersByComponent.set(dep.refComponentId, set);
    componentMeta.set(dep.refComponentId, { name: dep.refComponentName, type: dep.refComponentType });
  }
  for (const [componentId, referencers] of referencersByComponent) {
    if (referencers.size > GOD_COMPONENT_REFERENCER_THRESHOLD) {
      const meta = componentMeta.get(componentId)!;
      findings.push({
        category: "architecture",
        ruleKey: "god_component",
        severity: "high",
        title: `${meta.name} is referenced by ${referencers.size} other components`,
        detail: `Exceeds ${GOD_COMPONENT_REFERENCER_THRESHOLD} distinct referencing components; a change here has a very large blast radius across the org.`,
        componentType: meta.type,
        componentName: meta.name,
      });
    }
  }

  return findings;
}
