import { prisma } from "../prisma";

export type UsageRef = { type: string; name: string };
export type ComponentUsage = { usedIn: UsageRef[] };

const BATCH_APEX_RE = /\bDatabase\.Batchable\b/i;
const TEST_APEX_RE = /@istest\b/i;
const QUEUEABLE_APEX_RE = /\bimplements\s+[\w\s,.]*\bQueueable\b/i;
const FUTURE_APEX_RE = /@future\b/i;

// ponytail: regex classification off class body text, same approach as classifyFlow below.
// Order matters — a class can match more than one (e.g. a test class asserting on a batch
// job), so we pick the most specific label a developer would actually call it.
function classifyApexClass(body: string): string {
  if (TEST_APEX_RE.test(body)) return "Test Class";
  if (BATCH_APEX_RE.test(body)) return "Batch Class";
  if (QUEUEABLE_APEX_RE.test(body)) return "Queueable Class";
  if (FUTURE_APEX_RE.test(body)) return "Future Class";
  return "Apex Class";
}

// ponytail: substring search across scanned source text, not a real AST/dependency graph.
// Only used as a fallback when a component has no Salesforce Id or the org didn't
// return dependency data at all (see usageFor below) — good enough for that case, but
// will miss references built from dynamic strings (e.g. field names assembled at runtime).
function findReferences(name: string, haystacks: { type: string; name: string; text: string }[]): UsageRef[] {
  const refs: UsageRef[] = [];
  for (const h of haystacks) {
    if (h.name === name) continue;
    if (h.text.includes(name)) refs.push({ type: h.type, name: h.name });
  }
  return refs;
}

// ponytail: covers Winter '20+ flow metadata (start.triggerType). Legacy pre-autolayout
// scheduled flows without a `start` block fall through to "Autolaunched Flow" — fine, rare in practice.
function classifyFlow(triggerType: string | null, processType: string | undefined): string {
  // Process Builder processes are Flow metadata with processType "Workflow". (Verified
  // against real scan data that processMetadataValues is NOT a reliable secondary signal —
  // it's present on AutoLaunchedFlow/Flow/TransactionSecurityFlow too, so using it as a
  // fallback mislabels everything. processType alone is the correct, sufficient check.)
  if (processType === "Workflow") return "Process Builder";
  if (triggerType === "PlatformEvent") return "Platform Event-Triggered Flow";
  if (triggerType === "Scheduled") return "Scheduled-Triggered Flow";
  if (triggerType === "RecordAfterSave" || triggerType === "RecordBeforeSave") return "Record-Triggered Flow";
  if (processType === "Flow") return "Screen Flow";
  return "Autolaunched Flow";
}

function dedupeRefs(refs: UsageRef[]): UsageRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const key = `${r.type}:${r.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getComponentUsage(scanId: string) {
  const [
    objects,
    fields,
    classes,
    triggers,
    flows,
    workflowRules,
    lwc,
    dependencies,
    profiles,
    permissionSets,
    emailTemplates,
    visualforcePages,
    visualforceComponents,
    installedPackages,
  ] = await Promise.all([
    prisma.sfObject.findMany({ where: { scanId } }),
    prisma.sfField.findMany({ where: { object: { scanId } } }),
    prisma.apexClass.findMany({ where: { scanId } }),
    prisma.apexTrigger.findMany({ where: { scanId } }),
    prisma.flow.findMany({ where: { scanId } }),
    prisma.workflowRule.findMany({ where: { scanId } }),
    prisma.lwcComponent.findMany({ where: { scanId } }),
    prisma.componentDependency.findMany({ where: { scanId } }),
    prisma.profile.findMany({ where: { scanId } }),
    prisma.permissionSet.findMany({ where: { scanId } }),
    prisma.emailTemplate.findMany({ where: { scanId } }),
    prisma.visualforcePage.findMany({ where: { scanId } }),
    prisma.visualforceComponent.findMany({ where: { scanId } }),
    prisma.installedPackage.findMany({ where: { scanId } }),
  ]);

  const haystacks = [
    ...classes.map((c) => ({ type: "ApexClass", name: c.name, text: c.body })),
    ...triggers.map((t) => ({ type: "ApexTrigger", name: t.name, text: t.body })),
    ...flows.map((f) => ({ type: "Flow", name: f.apiName, text: JSON.stringify(f.definition || {}) })),
    ...lwc.map((l) => ({ type: "LightningWebComponent", name: l.apiName, text: l.source })),
  ];

  // Real dependency edges (Tooling API MetadataComponentDependency) take priority over
  // substring search — they also catch references from metadata we never read the body
  // of (page layouts, validation rules, reports), which text search can't see at all.
  const dependentsBySfId = new Map<string, UsageRef[]>();
  const referencesBySfId = new Map<string, UsageRef[]>();
  for (const dep of dependencies) {
    dependentsBySfId.set(dep.refComponentId, [
      ...(dependentsBySfId.get(dep.refComponentId) || []),
      { type: dep.componentType, name: dep.componentName },
    ]);
    referencesBySfId.set(dep.componentId, [
      ...(referencesBySfId.get(dep.componentId) || []),
      { type: dep.refComponentType, name: dep.refComponentName },
    ]);
  }
  const hasDependencyData = dependencies.length > 0;

  function usageFor(sfId: string | null, name: string): UsageRef[] {
    if (hasDependencyData && sfId) return dedupeRefs(dependentsBySfId.get(sfId) || []);
    return findReferences(name, haystacks);
  }

  // What this component itself depends on (the reverse direction of usageFor). Only
  // available from real dependency-edge data — there's no substring-search fallback for
  // "what does X's own body mention," so this is empty when the org returned no edges.
  function referencesFor(sfId: string | null): UsageRef[] {
    if (hasDependencyData && sfId) return dedupeRefs(referencesBySfId.get(sfId) || []);
    return [];
  }

  // Salesforce's XML->JSON conversion collapses a single-element list into a plain object,
  // so fieldPermissions/objectPermissions might not be an array at all.
  function asArray<T>(value: T | T[] | undefined | null): T[] {
    if (Array.isArray(value)) return value;
    return value ? [value] : [];
  }

  type AccessGrant = { name: string; type: "Profile" | "PermissionSet"; level: string };
  const fieldAccessByKey = new Map<string, AccessGrant[]>();
  const objectAccessByName = new Map<string, AccessGrant[]>();

  const permissionHolders: { name: string; type: "Profile" | "PermissionSet"; permJson: unknown }[] = [
    ...profiles.map((p) => ({ name: p.name, type: "Profile" as const, permJson: p.permJson })),
    ...permissionSets.map((p) => ({ name: p.name, type: "PermissionSet" as const, permJson: p.permJson })),
  ];

  for (const holder of permissionHolders) {
    const { type, name } = holder;
    const json = holder.permJson as any;
    for (const fp of asArray(json?.fieldPermissions)) {
      if (!fp?.field || (!fp.editable && !fp.readable)) continue;
      const level = fp.editable ? "Edit" : "Read Only";
      fieldAccessByKey.set(fp.field, [...(fieldAccessByKey.get(fp.field) || []), { name, type, level }]);
    }
    for (const op of asArray(json?.objectPermissions)) {
      if (!op?.object) continue;
      const level = op.modifyAllRecords ? "Full Access" : op.allowEdit ? "Edit" : op.allowRead ? "Read Only" : null;
      if (!level) continue;
      objectAccessByName.set(op.object, [...(objectAccessByName.get(op.object) || []), { name, type, level }]);
    }
  }

  return {
    objects: objects.map((o) => ({
      apiName: o.apiName,
      label: o.label,
      usedIn: usageFor(o.sfId, o.apiName),
      references: referencesFor(o.sfId),
      access: objectAccessByName.get(o.apiName) || [],
      fields: fields
        .filter((f) => f.objectId === o.id)
        .map((f) => ({
          apiName: f.apiName,
          type: f.type,
          usedIn: usageFor(f.sfId, f.apiName),
          references: referencesFor(f.sfId),
          access: fieldAccessByKey.get(`${o.apiName}.${f.apiName}`) || [],
        })),
    })),
    classes: classes.map((c) => ({
      name: c.name,
      usedIn: usageFor(c.sfId, c.name),
      references: referencesFor(c.sfId),
      isBatch: BATCH_APEX_RE.test(c.body),
      category: classifyApexClass(c.body),
    })),
    triggers: triggers.map((t) => ({
      name: t.name,
      usedIn: usageFor(t.sfId, t.name),
      references: referencesFor(t.sfId),
    })),
    flows: flows.map((f) => ({
      apiName: f.apiName,
      label: f.label,
      status: f.status,
      category: classifyFlow(f.triggerType, (f.definition as any)?.processType),
      usedIn: usageFor(f.sfId, f.apiName),
      references: referencesFor(f.sfId),
    })),
    workflowRules: workflowRules.map((w) => ({
      name: w.name,
      objectName: w.objectName,
      active: w.active,
      triggerType: w.triggerType,
      usedIn: usageFor(w.sfId, w.name),
      references: referencesFor(w.sfId),
    })),
    lwc: lwc.map((l) => ({
      apiName: l.apiName,
      usedIn: usageFor(l.sfId, l.apiName),
      references: referencesFor(l.sfId),
    })),
    visualforcePages: visualforcePages.map((p) => ({
      name: p.name,
      usedIn: usageFor(p.sfId, p.name),
      references: referencesFor(p.sfId),
    })),
    visualforceComponents: visualforceComponents.map((c) => ({
      name: c.name,
      usedIn: usageFor(c.sfId, c.name),
      references: referencesFor(c.sfId),
    })),
    // Email templates and installed packages aren't tracked in Salesforce's dependency
    // graph the way code/UI components are — listed for visibility, no usage graph.
    emailTemplates: emailTemplates.map((t) => ({
      name: t.name,
      developerName: t.developerName,
      templateType: t.templateType,
      isActive: t.isActive,
    })),
    installedPackages: installedPackages.map((p) => ({
      name: p.name,
      namespacePrefix: p.namespacePrefix,
      versionName: p.versionName,
      versionNumber: p.versionNumber,
    })),
  };
}
