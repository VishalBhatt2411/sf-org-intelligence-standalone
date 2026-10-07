import type { SfObject, SfField, ApexClass, ApexTrigger, Flow, LwcComponent, ComponentDependency } from "@prisma/client";
import type { NewFinding } from "./codeQuality";

// Invoked by the platform (Setup UI, cron, inbound email service), not by a static
// reference anywhere else in metadata — flagging these as "unused" would be a false positive.
const ENTRY_POINT_RE = /\b(implements|extends)\s+[\w\s,<>.]*\b(Batchable|Schedulable|Queueable|InboundEmailHandler)\b/i;
const TEST_CLASS_RE = /@isTest/i;

// Prefers real Salesforce dependency data (Tooling API MetadataComponentDependency) when
// the scan captured it — it also catches references in metadata we never read the body
// of (layouts, validation rules, reports). Falls back to substring search over scanned
// Apex/trigger/flow text when dependency data wasn't available for a component (no sfId,
// or the org didn't expose the Tooling object at all).
// ponytail: substring fallback can still false-negative on dynamically built references (e.g. SOQL from variables).
export function analyzeDataQuality(
  objects: SfObject[],
  fields: SfField[],
  classes: ApexClass[],
  triggers: ApexTrigger[],
  flows: Flow[],
  lwcComponents: LwcComponent[],
  dependencies: ComponentDependency[]
): NewFinding[] {
  const findings: NewFinding[] = [];

  const haystack = [
    ...classes.map((c) => c.body),
    ...triggers.map((t) => t.body),
    ...flows.map((f) => JSON.stringify(f.definition || {})),
  ].join("\n");

  const usedSfIds = new Set(dependencies.map((d) => d.refComponentId));
  const hasDependencyData = dependencies.length > 0;

  function isUsed(sfId: string | null, substringNeedle: string): boolean {
    if (hasDependencyData && sfId) return usedSfIds.has(sfId);
    return haystack.includes(substringNeedle);
  }

  const objectsById = new Map(objects.map((o) => [o.id, o]));
  const fieldsByObject = new Map<string, SfField[]>();
  for (const field of fields) {
    fieldsByObject.set(field.objectId, [...(fieldsByObject.get(field.objectId) || []), field]);
  }

  for (const field of fields) {
    if (!field.apiName.endsWith("__c")) continue;
    if (!isUsed(field.sfId, field.apiName)) {
      const object = objectsById.get(field.objectId);
      const verifiedByDependencyApi = hasDependencyData && Boolean(field.sfId);
      findings.push({
        category: "data_quality",
        ruleKey: "unused_field",
        severity: "low",
        title: `${field.apiName} appears unused`,
        detail: verifiedByDependencyApi
          ? `No metadata component references this field on ${object?.apiName ?? "unknown object"} (verified via Salesforce's dependency data).`
          : `Not referenced in any scanned Apex class, trigger, or flow on ${object?.apiName ?? "unknown object"}.`,
        componentType: "SfField",
        componentName: `${object?.apiName ?? "unknown"}.${field.apiName}`,
      });
    }
  }

  for (const [objectId, group] of fieldsByObject) {
    const seenLabels = new Map<string, string>();
    const object = objectsById.get(objectId);
    for (const field of group) {
      const key = field.apiName.replace(/__c$/, "").toLowerCase();
      const clash = seenLabels.get(key);
      if (clash && clash !== field.apiName) {
        findings.push({
          category: "data_quality",
          ruleKey: "duplicate_field",
          severity: "low",
          title: `Possible duplicate fields on ${object?.apiName ?? "object"}: ${clash} / ${field.apiName}`,
          detail: "Similarly-named fields on the same object often indicate redundant data capture.",
          componentType: "SfField",
          componentName: `${object?.apiName ?? "unknown"}.${field.apiName}`,
        });
      } else {
        seenLabels.set(key, field.apiName);
      }
    }
  }

  for (const object of objects) {
    if (!object.apiName.endsWith("__c")) continue;
    if (!isUsed(object.sfId, object.apiName.replace("__c", ""))) {
      const verifiedByDependencyApi = hasDependencyData && Boolean(object.sfId);
      findings.push({
        category: "data_quality",
        ruleKey: "unused_object",
        severity: "low",
        title: `${object.apiName} appears unused`,
        detail: verifiedByDependencyApi
          ? "No metadata component references this object (verified via Salesforce's dependency data)."
          : "Not referenced by name in any scanned Apex class, trigger, or flow.",
        componentType: "SfObject",
        componentName: object.apiName,
      });
    }
  }

  if (hasDependencyData) {
    for (const cls of classes) {
      if (!cls.sfId || TEST_CLASS_RE.test(cls.body) || ENTRY_POINT_RE.test(cls.body)) continue;
      if (!usedSfIds.has(cls.sfId)) {
        findings.push({
          category: "data_quality",
          ruleKey: "unused_apex_class",
          severity: "low",
          title: `${cls.name} appears unused`,
          detail: "No metadata component references this class (verified via Salesforce's dependency data).",
          componentType: "ApexClass",
          componentName: cls.name,
        });
      }
    }

    for (const lwc of lwcComponents) {
      if (!lwc.sfId) continue;
      if (!usedSfIds.has(lwc.sfId)) {
        findings.push({
          category: "data_quality",
          ruleKey: "unused_lwc",
          severity: "low",
          title: `${lwc.apiName} appears unused`,
          detail: "No metadata component references this Lightning Web Component (verified via Salesforce's dependency data).",
          componentType: "LightningWebComponent",
          componentName: lwc.apiName,
        });
      }
    }
  }

  return findings;
}
