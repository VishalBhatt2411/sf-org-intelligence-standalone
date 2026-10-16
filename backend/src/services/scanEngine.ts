import type { Connection } from "jsforce";
import { prisma } from "../prisma";
import { getConnection } from "./salesforce";
import { emptyScanExtras, PrismaScanInputs, type ScanExtras } from "../graph/graphInputs";
import { PrismaGraphRepository } from "../graph/graphRepository";
import { JsforceGraphSource, queryAll } from "../graph/graphSource";
import { runGraphStage, type SectionCoverage } from "../graph/graphStage";
import type { ApexMeta } from "../graph/scanners/inputs";
import { hasNoiseSuffix } from "../graph/scope";
import { resolveGraphSettings } from "../graph/settings";
import { healthService } from "../health/defaultHealthService";

// A section returns its item count, or a count with a coverage note when it knows it saw less than all.
type SectionOutcome = number | { count: number; coverage: SectionCoverage["coverage"]; detail?: string | null };

// Metadata API's read() rejects more than 10 names per call (EXCEEDED_ID_LIMIT).
const METADATA_READ_BATCH_SIZE = 10;

// Conservative batch size for MetadataComponentDependency's IN-clause — keeps the
// generated SOQL well under Salesforce's query length limit.
const DEPENDENCY_QUERY_BATCH_SIZE = 100;

const SF_ID_PATTERN = /^[a-zA-Z0-9]{15,18}$/;

// Cap on simultaneous in-flight requests to Salesforce — high enough to meaningfully
// parallelize describe()/metadata-read calls (which are network-wait-bound, not CPU-bound),
// conservative enough to avoid tripping the org's concurrent-API-request limit.
const API_CONCURRENCY = 8;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// Runs `fn` over `items` with at most `limit` calls in flight at once, preserving result
// order regardless of which finishes first — a lightweight worker-pool, not a queue library.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// Native object universe: every queryable sObject minus the companion/non-record suffixes (History, Feed,
// Share, ChangeEvent, __mdt, __e, __b, __x). Which of them end up in the graph is decided later by scope.
// Scanning every queryable sobject can mean 500+ describe calls, so this can noticeably lengthen scan time
// on large orgs - accepted tradeoff for full object coverage.
async function listObjectTargets(conn: Connection): Promise<string[]> {
  const global = await conn.describeGlobal();
  return global.sobjects.filter((o) => o.queryable && !hasNoiseSuffix(o.name)).map((o) => o.name);
}

// Reads metadata in batches of 10, like readMetadataBatched, but a failing batch is retried one name at a
// time so a single bad name costs only itself. The result stays aligned with `names` (null for a name that
// could not be read); `failed` lists those, except names Salesforce reports as simply not applicable.
async function readMetadataTolerant(conn: Connection, type: string, names: string[], notApplicable?: RegExp): Promise<{ results: any[]; failed: string[] }> {
  const results: any[] = new Array(names.length).fill(null);
  const failed: string[] = [];
  const offsets = chunk(
    names.map((_, i) => i),
    METADATA_READ_BATCH_SIZE
  );
  await mapWithConcurrency(offsets, API_CONCURRENCY, async (indices) => {
    try {
      const read = await conn.metadata.read(type as any, indices.map((i) => names[i]));
      const list = Array.isArray(read) ? read : [read];
      indices.forEach((idx, k) => (results[idx] = list[k] ?? null));
    } catch {
      for (const idx of indices) {
        try {
          const one = await conn.metadata.read(type as any, [names[idx]]);
          results[idx] = (Array.isArray(one) ? one[0] : one) ?? null;
        } catch (err) {
          if (!notApplicable?.test((err as Error).message ?? "")) failed.push(names[idx]);
        }
      }
    }
  });
  return { results, failed };
}

async function readMetadataBatched(conn: Connection, type: string, names: string[]): Promise<any[]> {
  const batches = chunk(names, METADATA_READ_BATCH_SIZE);
  const batchResults = await mapWithConcurrency(batches, API_CONCURRENCY, (batch) => conn.metadata.read(type as any, batch));
  return batchResults.flatMap((read) => (Array.isArray(read) ? read : [read]));
}

// Standard describe() doesn't expose the Tooling API record Ids that
// MetadataComponentDependency keys off of — custom objects/fields have their own
// CustomObject/CustomField Tooling records, fetched separately and matched by API name.
// Tooling DeveloperName has neither the namespace nor the suffix, so the API name is rebuilt from both.
const toolingApiName = (r: { DeveloperName: string; NamespacePrefix: string | null }) => `${r.NamespacePrefix ? `${r.NamespacePrefix}__` : ""}${r.DeveloperName}__c`;

async function loadCustomObjectIds(conn: Connection): Promise<Map<string, string>> {
  type Row = { Id: string; DeveloperName: string; NamespacePrefix: string | null };
  const records = await queryAll<Row>((await conn.tooling.query<Row>("SELECT Id, DeveloperName, NamespacePrefix FROM CustomObject")) as { records: Row[] }, async (l) => (await conn.tooling.queryMore<Row>(l)) as { records: Row[] });
  return new Map(records.map((r) => [toolingApiName(r), r.Id]));
}

// Keyed "Object.Field". TableEnumOrId is the object's name for a standard object but its CustomObject Id
// for a custom one, so custom-object fields are resolved back to the object's API name via objectIds.
async function loadCustomFieldIds(conn: Connection, objectIds: Map<string, string>): Promise<Map<string, string>> {
  const objectNameById = new Map([...objectIds].map(([name, id]) => [id, name]));
  type Row = { Id: string; DeveloperName: string; NamespacePrefix: string | null; TableEnumOrId: string };
  const records = await queryAll<Row>((await conn.tooling.query<Row>("SELECT Id, DeveloperName, NamespacePrefix, TableEnumOrId FROM CustomField")) as { records: Row[] }, async (l) => (await conn.tooling.queryMore<Row>(l)) as { records: Row[] });
  const out = new Map<string, string>();
  for (const r of records) {
    const objectName = objectNameById.get(r.TableEnumOrId) ?? objectNameById.get(r.TableEnumOrId.slice(0, 15)) ?? r.TableEnumOrId;
    out.set(`${objectName}.${toolingApiName(r)}`, r.Id);
  }
  return out;
}

async function scanObjectsAndFields(conn: Connection, scanId: string, targetNames: string[], extras: ScanExtras) {
  // Best-effort — standard-only orgs or restricted API access shouldn't block the rest of the scan.
  let idLookupFailed = false;
  const orEmpty = (p: Promise<Map<string, string>>) =>
    p.catch(() => {
      idLookupFailed = true;
      return new Map<string, string>();
    });
  const objectIds = await orEmpty(loadCustomObjectIds(conn));
  const fieldIds = await orEmpty(loadCustomFieldIds(conn, objectIds));

  const outcomes = await mapWithConcurrency(targetNames, API_CONCURRENCY, async (targetName) => {
    try {
      const described = await conn.describe(targetName);
      const sfObject = await prisma.sfObject.create({
        data: {
          scanId,
          apiName: described.name,
          label: described.label,
          fieldCount: described.fields.length,
          sfId: objectIds.get(described.name) || null,
        },
      });

      for (const f of described.fields) if (f.label) extras.fieldLabels.set(`${described.name}.${f.name}`, f.label);
      await prisma.sfField.createMany({
        data: described.fields.map((f) => ({
          objectId: sfObject.id,
          apiName: f.name,
          type: f.type,
          referenceTo: f.referenceTo && f.referenceTo.length ? f.referenceTo : undefined,
          sfId: fieldIds.get(`${described.name}.${f.name}`) || null,
        })),
      });
      return true;
    } catch (err) {
      // With every standard object now in scope, some will be inaccessible/undescribable
      // for this user's permissions — skip just that one instead of losing the whole scan.
      console.warn(`describe() failed for "${targetName}", skipping:`, (err as Error).message);
      return false;
    }
  });

  const count = outcomes.filter(Boolean).length;
  const failed = outcomes.length - count;
  const problems = [failed > 0 ? `describe failed for ${failed} object(s)` : null, idLookupFailed ? "custom object/field Id lookup failed" : null].filter(Boolean);
  return problems.length > 0 ? { count, coverage: "partial" as const, detail: problems.join("; ") } : count;
}

// OWD is exposed on the same CustomObject metadata record standard objects that support
// custom sharing settings (Account, Contact, etc.) also return it — no separate API exists.
async function scanSharingModel(conn: Connection, scanId: string, targetNames: string[]) {
  if (targetNames.length === 0) return 0;
  const { results: arr, failed } = await readMetadataTolerant(conn, "CustomObject", targetNames);

  const rows = arr
    .map((o: any, i: number) => ({ apiName: targetNames[i], o }))
    .filter(({ o }) => o?.sharingModel);

  if (rows.length > 0) {
    await prisma.orgWideDefault.createMany({
      data: rows.map(({ apiName, o }) => ({
        scanId,
        apiName,
        internalSharingModel: o.sharingModel,
        externalSharingModel: o.externalSharingModel || null,
      })),
    });
  }
  return failed.length > 0 ? { count: rows.length, coverage: "partial" as const, detail: `org-wide default could not be read for ${failed.length} object(s)` } : rows.length;
}

// SharingRules is only a valid metadata type for objects with a customizable org-wide
// default — reading it for anything else (most standard objects, ControlledByParent
// detail objects) throws INVALID_CROSS_REFERENCE_KEY and takes out the whole batch of 10.
// Scope to objects the sharing-model scan (which runs first, see runScan) already
// confirmed are OWD-eligible, so this never asks about an ineligible object.
async function scanSharingRules(conn: Connection, scanId: string, extras: ScanExtras) {
  const eligibleObjects = await prisma.orgWideDefault.findMany({
    where: { scanId, internalSharingModel: { not: "ControlledByParent" } },
    select: { apiName: true },
  });
  const targetNames = eligibleObjects.map((o) => o.apiName);
  if (targetNames.length === 0) return 0;
  // INVALID_CROSS_REFERENCE_KEY means "this object has no sharing rules to read", not a failure.
  const { results: arr, failed } = await readMetadataTolerant(conn, "SharingRules", targetNames, /INVALID_CROSS_REFERENCE_KEY/);

  // Native rule types are the metadata element names.
  const groups: [string, string][] = [
    ["sharingCriteriaRules", "SharingCriteriaRule"],
    ["sharingOwnerRules", "SharingOwnerRule"],
    ["sharingGuestRules", "SharingGuestRule"],
    ["sharingTerritoryRules", "SharingTerritoryRule"],
  ];
  const rows: { name: string; objectName: string; ruleType: string; accessLevel: string }[] = [];
  arr.forEach((sr: any, i: number) => {
    if (!sr) return;
    const objectName = targetNames[i];
    for (const [key, ruleType] of groups) {
      for (const rule of asArray<any>(sr[key])) {
        const name = rule.fullName || rule.label || "Unnamed rule";
        rows.push({ name, objectName, ruleType, accessLevel: rule.accessLevel || "Unknown" });
        extras.sharing.set(`${objectName}.${name}`, {
          label: rule.label ?? null,
          description: rule.description ?? null,
          sharedTo: rule.sharedTo ?? null,
          sharedFrom: rule.sharedFrom ?? null,
          accountSettings: rule.accountSettings ?? null,
          booleanFilter: rule.booleanFilter ?? null,
          criteriaItems: rule.criteriaItems ?? null,
          includeRecordsOwnedByAll: rule.includeRecordsOwnedByAll ?? null,
          includeHVUOwnedRecords: rule.includeHVUOwnedRecords ?? null,
        });
      }
    }
  });

  if (rows.length > 0) await prisma.sharingRule.createMany({ data: rows.map((r) => ({ scanId, ...r })) });
  return failed.length > 0 ? { count: rows.length, coverage: "partial" as const, detail: `sharing rules could not be read for ${failed.length} object(s)` } : rows.length;
}

async function scanRoleHierarchy(conn: Connection, scanId: string) {
  const result = await conn.query<{ Id: string; Name: string; DeveloperName: string; ParentRoleId: string | null }>(
    "SELECT Id, Name, DeveloperName, ParentRoleId FROM UserRole"
  );
  if (result.records.length === 0) return 0;

  await prisma.userRole.createMany({
    data: result.records.map((r) => ({
      scanId,
      name: r.Name,
      developerName: r.DeveloperName,
      parentRoleId: r.ParentRoleId,
      sfId: r.Id,
    })),
  });
  return result.records.length;
}

type ApexRow = {
  Id: string;
  Name: string;
  Body: string | null;
  ApiVersion: number | null;
  NamespacePrefix?: string | null;
  Status?: string | null;
  IsValid?: boolean | null;
  BodyCrc?: number | null;
  LengthWithoutComments?: number | null;
  TableEnumOrId?: string;
};

const apexMeta = (r: ApexRow): ApexMeta => ({
  namespace: r.NamespacePrefix || null,
  status: r.Status ?? null,
  isValid: typeof r.IsValid === "boolean" ? r.IsValid : null,
  bodyCrc: typeof r.BodyCrc === "number" ? r.BodyCrc : null,
  lengthWithoutComments: typeof r.LengthWithoutComments === "number" ? r.LengthWithoutComments : null,
  apiVersion: r.ApiVersion ?? null,
});

// Body is a long-text field - Tooling API rejects it in a WHERE clause (INVALID_FIELD). The extended column
// set is the native one; if the org rejects it the basic query still yields the classes.
async function queryApex(conn: Connection, object: "ApexClass" | "ApexTrigger"): Promise<ApexRow[]> {
  const table = object === "ApexTrigger" ? ", TableEnumOrId" : "";
  const run = async (q: string) =>
    queryAll<ApexRow>((await conn.tooling.query<ApexRow>(q)) as { records: ApexRow[] }, async (l) => (await conn.tooling.queryMore<ApexRow>(l)) as { records: ApexRow[] });
  try {
    return await run(`SELECT Id, Name${table}, Body, ApiVersion, NamespacePrefix, Status, IsValid, BodyCrc, LengthWithoutComments FROM ${object}`);
  } catch (err) {
    console.warn(`${object} extended query failed, using the basic one:`, (err as Error).message);
    return run(`SELECT Id, Name${table}, Body, ApiVersion FROM ${object}`);
  }
}

async function scanApexClasses(conn: Connection, scanId: string, extras: ScanExtras) {
  const rows = await queryApex(conn, "ApexClass");
  const withBody = rows.filter((r) => r.Body);
  for (const r of rows) extras.apexMeta.set(r.Id, apexMeta(r));
  // Classes whose source the API hides (managed packages) still exist: the graph gets them, the tables
  // (which the analysis modules read for bodies) do not.
  extras.hiddenClasses = rows.filter((r) => !r.Body).map((r) => ({ name: r.Name, sfId: r.Id, body: "", lineCount: 0, apiVersion: r.ApiVersion ?? null, meta: apexMeta(r) }));

  await prisma.apexClass.createMany({
    data: withBody.map((r) => ({
      scanId,
      name: r.Name,
      body: r.Body!,
      lineCount: r.Body!.split("\n").length,
      sfId: r.Id,
      apiVersion: r.ApiVersion ?? null,
    })),
  });

  return withBody.length;
}

async function scanTriggers(conn: Connection, scanId: string, extras: ScanExtras) {
  const rows = await queryApex(conn, "ApexTrigger");
  const withBody = rows.filter((r) => r.Body);
  for (const r of rows) extras.triggerMeta.set(r.Id, apexMeta(r));
  extras.hiddenTriggers = rows.filter((r) => !r.Body).map((r) => ({ name: r.Name, sfId: r.Id, objectName: r.TableEnumOrId ?? "", body: "", meta: apexMeta(r) }));

  await prisma.apexTrigger.createMany({
    data: withBody.map((r) => ({
      scanId,
      name: r.Name,
      objectName: r.TableEnumOrId ?? "",
      body: r.Body!,
      sfId: r.Id,
    })),
  });

  return withBody.length;
}

async function scanFlows(conn: Connection, scanId: string) {
  const listed = await conn.metadata.list([{ type: "Flow" }]);
  const entries = Array.isArray(listed) ? listed : listed ? [listed] : [];
  if (entries.length === 0) return 0;

  const fullNames = entries.map((e: any) => e.fullName);
  const defArray = await readMetadataBatched(conn, "Flow", fullNames);

  await prisma.flow.createMany({
    data: defArray.map((d: any, i: number) => ({
      scanId,
      apiName: fullNames[i],
      label: d.label || fullNames[i],
      status: d.status || "Unknown",
      triggerType: d.start?.triggerType || null,
      objectName: d.start?.object || null,
      definition: d as any,
      sfId: entries[i]?.id || null,
    })),
  });

  return defArray.length;
}

// Workflow Rules are the pre-Flow automation type — unlike Process Builder, Salesforce
// never migrated these onto Flow metadata, so they need their own scan. fullName comes
// back as "ObjectName.RuleName".
async function scanWorkflowRules(conn: Connection, scanId: string, extras: ScanExtras) {
  const listed = await conn.metadata.list([{ type: "WorkflowRule" }]);
  const entries = Array.isArray(listed) ? listed : listed ? [listed] : [];
  if (entries.length === 0) return 0;

  const fullNames = entries.map((e: any) => e.fullName);
  const defArray = await readMetadataBatched(conn, "WorkflowRule", fullNames);

  await prisma.workflowRule.createMany({
    data: defArray.map((d: any, i: number) => {
      const [objectName, ruleName] = fullNames[i].split(".");
      extras.workflow.set(`${objectName}.${ruleName || fullNames[i]}`, {
        description: typeof d?.description === "string" && d.description ? d.description : null,
        formula: typeof d?.formula === "string" && d.formula ? d.formula : null,
        namespace: (entries[i] as any)?.namespacePrefix || null,
      });
      return {
        scanId,
        objectName,
        name: ruleName || fullNames[i],
        active: Boolean(d.active),
        triggerType: d.triggerType || null,
        sfId: entries[i]?.id || null,
      };
    }),
  });

  return defArray.length;
}

async function scanLwc(conn: Connection, scanId: string) {
  const result = await conn.tooling.query<{
    Source: string;
    LightningComponentBundle: { DeveloperName: string; Id: string } | null;
  }>("SELECT Source, LightningComponentBundle.DeveloperName, LightningComponentBundle.Id FROM LightningComponentResource");

  const sourceByBundle = new Map<string, string[]>();
  const sfIdByBundle = new Map<string, string>();
  for (const r of result.records) {
    const name = r.LightningComponentBundle?.DeveloperName;
    if (!name) continue;
    sourceByBundle.set(name, [...(sourceByBundle.get(name) || []), r.Source]);
    if (r.LightningComponentBundle?.Id) sfIdByBundle.set(name, r.LightningComponentBundle.Id);
  }

  await prisma.lwcComponent.createMany({
    data: Array.from(sourceByBundle.entries()).map(([apiName, sources]) => ({
      scanId,
      apiName,
      source: sources.join("\n"),
      sfId: sfIdByBundle.get(apiName) || null,
    })),
  });

  return sourceByBundle.size;
}

async function scanPermissions(conn: Connection, scanId: string) {
  const [profileList, permSetList] = await Promise.all([
    conn.metadata.list([{ type: "Profile" }]),
    conn.metadata.list([{ type: "PermissionSet" }]),
  ]);

  const profileEntries = Array.isArray(profileList) ? profileList : profileList ? [profileList] : [];
  const permSetEntries = Array.isArray(permSetList) ? permSetList : permSetList ? [permSetList] : [];
  const profileNames = profileEntries.map((e: any) => e.fullName);
  const permSetNames = permSetEntries.map((e: any) => e.fullName);

  if (profileNames.length > 0) {
    const arr = await readMetadataBatched(conn, "Profile", profileNames);
    await prisma.profile.createMany({
      data: arr.map((p: any, i: number) => ({
        scanId,
        name: profileNames[i],
        permJson: p as any,
        sfId: profileEntries[i]?.id || null,
      })),
    });
  }

  if (permSetNames.length > 0) {
    const arr = await readMetadataBatched(conn, "PermissionSet", permSetNames);
    await prisma.permissionSet.createMany({
      data: arr.map((p: any, i: number) => ({
        scanId,
        name: permSetNames[i],
        permJson: p as any,
        sfId: permSetEntries[i]?.id || null,
      })),
    });
  }

  return profileNames.length + permSetNames.length;
}

async function scanEmailTemplates(conn: Connection, scanId: string) {
  const result = await conn.query<{
    Id: string;
    Name: string;
    DeveloperName: string;
    TemplateType: string;
    IsActive: boolean;
  }>("SELECT Id, Name, DeveloperName, TemplateType, IsActive FROM EmailTemplate");

  await prisma.emailTemplate.createMany({
    data: result.records.map((r) => ({
      scanId,
      name: r.Name,
      developerName: r.DeveloperName,
      templateType: r.TemplateType,
      isActive: r.IsActive,
      sfId: r.Id,
    })),
  });

  return result.records.length;
}

async function scanVisualforcePages(conn: Connection, scanId: string) {
  const result = await conn.tooling.query<{ Id: string; Name: string; Markup: string | null }>(
    "SELECT Id, Name, Markup FROM ApexPage"
  );
  const withMarkup = result.records.filter((r) => r.Markup);

  await prisma.visualforcePage.createMany({
    data: withMarkup.map((r) => ({ scanId, name: r.Name, markup: r.Markup!, sfId: r.Id })),
  });

  return withMarkup.length;
}

async function scanVisualforceComponents(conn: Connection, scanId: string) {
  const result = await conn.tooling.query<{ Id: string; Name: string; Markup: string | null }>(
    "SELECT Id, Name, Markup FROM ApexComponent"
  );
  const withMarkup = result.records.filter((r) => r.Markup);

  await prisma.visualforceComponent.createMany({
    data: withMarkup.map((r) => ({ scanId, name: r.Name, markup: r.Markup!, sfId: r.Id })),
  });

  return withMarkup.length;
}

async function scanInstalledPackages(conn: Connection, scanId: string) {
  const result = await conn.tooling.query<{
    Id: string;
    SubscriberPackage: { Name: string; NamespacePrefix: string } | null;
    SubscriberPackageVersion: { Name: string; MajorVersion: number; MinorVersion: number } | null;
  }>(
    "SELECT Id, SubscriberPackage.Name, SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.Name, SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion FROM InstalledSubscriberPackage"
  );

  await prisma.installedPackage.createMany({
    data: result.records.map((r) => ({
      scanId,
      name: r.SubscriberPackage?.Name || "Unknown package",
      namespacePrefix: r.SubscriberPackage?.NamespacePrefix || "",
      versionName: r.SubscriberPackageVersion?.Name || null,
      versionNumber: r.SubscriberPackageVersion
        ? `${r.SubscriberPackageVersion.MajorVersion}.${r.SubscriberPackageVersion.MinorVersion}`
        : null,
    })),
  });

  return result.records.length;
}

type DependencyRow = {
  MetadataComponentId: string;
  MetadataComponentName: string;
  MetadataComponentType: string;
  RefMetadataComponentId: string;
  RefMetadataComponentName: string;
  RefMetadataComponentType: string;
};

// Real dependency edges from Tooling API's MetadataComponentDependency, keyed off the
// Salesforce Ids we've already captured for each scanned component. This replaces
// substring-search "is this used" guessing with data Salesforce computes itself —
// and it surfaces references from metadata we never scan the body of (layouts,
// validation rules, reports), which text search could never see.
// ponytail: requires the org to expose this Tooling object; some editions/permission
// setups don't — callers must tolerate an empty dependency set and fall back.
async function scanDependencies(conn: Connection, scanId: string) {
  const [classes, triggers, flows, workflowRules, lwc, objects, fields, vfPages, vfComponents, permissionSets] = await Promise.all([
    prisma.apexClass.findMany({ where: { scanId }, select: { sfId: true } }),
    prisma.apexTrigger.findMany({ where: { scanId }, select: { sfId: true } }),
    prisma.flow.findMany({ where: { scanId }, select: { sfId: true } }),
    prisma.workflowRule.findMany({ where: { scanId }, select: { sfId: true } }),
    prisma.lwcComponent.findMany({ where: { scanId }, select: { sfId: true } }),
    prisma.sfObject.findMany({ where: { scanId }, select: { sfId: true } }),
    prisma.sfField.findMany({ where: { object: { scanId } }, select: { sfId: true } }),
    prisma.visualforcePage.findMany({ where: { scanId }, select: { sfId: true } }),
    prisma.visualforceComponent.findMany({ where: { scanId }, select: { sfId: true } }),
    prisma.permissionSet.findMany({ where: { scanId }, select: { sfId: true } }),
  ]);

  // Validation rules, email alerts and approval processes are not stored by the scan, so their Ids are read
  // here. Each lookup is optional: a failure only means fewer components are covered.
  const optionalIds = async (label: string, load: () => Promise<{ Id: string }[]>) => {
    try {
      return (await load()).map((r) => ({ sfId: r.Id as string | null }));
    } catch (err) {
      console.warn(`dependency Id lookup for ${label} failed:`, (err as Error).message);
      return [] as { sfId: string | null }[];
    }
  };
  const toolingIds = (q: string) => async () => queryAll<{ Id: string }>((await conn.tooling.query<{ Id: string }>(q)) as { records: { Id: string }[] }, async (l) => (await conn.tooling.queryMore<{ Id: string }>(l)) as { records: { Id: string }[] });
  const [ruleIds, alertIds, approvalIds] = await Promise.all([
    optionalIds("validation rules", toolingIds("SELECT Id FROM ValidationRule")),
    optionalIds("email alerts", toolingIds("SELECT Id FROM WorkflowAlert")),
    optionalIds("approval processes", async () =>
      queryAll<{ Id: string }>((await conn.query<{ Id: string }>("SELECT Id FROM ProcessDefinition WHERE Type = 'Approval'")) as { records: { Id: string }[] }, async (l) => (await conn.queryMore<{ Id: string }>(l)) as { records: { Id: string }[] })
    ),
  ]);

  const ids = Array.from(
    new Set(
      [...classes, ...triggers, ...flows, ...workflowRules, ...lwc, ...objects, ...fields, ...vfPages, ...vfComponents, ...permissionSets, ...ruleIds, ...alertIds, ...approvalIds]
        .map((r) => r.sfId)
        .filter((id): id is string => Boolean(id) && SF_ID_PATTERN.test(id!))
    )
  );
  if (ids.length === 0) return 0;

  const batchCounts = await mapWithConcurrency(chunk(ids, DEPENDENCY_QUERY_BATCH_SIZE), API_CONCURRENCY, async (batch) => {
    const idList = batch.map((id) => `'${id}'`).join(",");
    const result = await conn.tooling.query<DependencyRow>(
      `SELECT MetadataComponentId, MetadataComponentName, MetadataComponentType, RefMetadataComponentId, RefMetadataComponentName, RefMetadataComponentType FROM MetadataComponentDependency WHERE RefMetadataComponentId IN (${idList})`
    );
    if (result.records.length === 0) return 0;

    await prisma.componentDependency.createMany({
      data: result.records.map((r) => ({
        scanId,
        componentId: r.MetadataComponentId,
        componentName: r.MetadataComponentName,
        componentType: r.MetadataComponentType,
        refComponentId: r.RefMetadataComponentId,
        refComponentName: r.RefMetadataComponentName,
        refComponentType: r.RefMetadataComponentType,
      })),
    });
    return result.records.length;
  });

  return batchCounts.reduce((sum, n) => sum + n, 0);
}

export async function runScan(connectionId: string) {
  const conn = await getConnection(connectionId);
  const scan = await prisma.scan.create({ data: { connectionId } });
  const targetNames = await listObjectTargets(conn);
  const extras = emptyScanExtras();

  const sections: Array<[string, () => Promise<SectionOutcome>]> = [
    ["objects", () => scanObjectsAndFields(conn, scan.id, targetNames, extras)],
    ["apex_classes", () => scanApexClasses(conn, scan.id, extras)],
    ["triggers", () => scanTriggers(conn, scan.id, extras)],
    ["flows", () => scanFlows(conn, scan.id)],
    ["workflow_rules", () => scanWorkflowRules(conn, scan.id, extras)],
    ["lwc", () => scanLwc(conn, scan.id)],
    ["email_templates", () => scanEmailTemplates(conn, scan.id)],
    ["visualforce_pages", () => scanVisualforcePages(conn, scan.id)],
    ["visualforce_components", () => scanVisualforceComponents(conn, scan.id)],
    ["installed_packages", () => scanInstalledPackages(conn, scan.id)],
    ["permissions", () => scanPermissions(conn, scan.id)],
    ["dependencies", () => scanDependencies(conn, scan.id)],
    ["sharing_model", () => scanSharingModel(conn, scan.id, targetNames)],
    ["sharing_rules", () => scanSharingRules(conn, scan.id, extras)],
    ["role_hierarchy", () => scanRoleHierarchy(conn, scan.id)],
  ];

  // A section that throws is recorded as degraded, so the graph stage never retires rows because a
  // section came back empty by failure rather than because the org has none.
  const sectionCoverage = new Map<string, SectionCoverage>();
  let degraded = false;
  for (const [category, run] of sections) {
    let record: { itemCount: number; coverage: SectionCoverage["coverage"]; coverageDetail: string | null };
    try {
      const outcome = await run();
      record =
        typeof outcome === "number"
          ? { itemCount: outcome, coverage: "complete", coverageDetail: null }
          : { itemCount: outcome.count, coverage: outcome.coverage, coverageDetail: outcome.detail ?? null };
    } catch (err) {
      console.warn(`scan section "${category}" failed:`, (err as Error).message);
      record = { itemCount: 0, coverage: "degraded", coverageDetail: String((err as Error).message).slice(0, 300) };
      degraded = true;
    }
    sectionCoverage.set(category, { coverage: record.coverage, detail: record.coverageDetail });
    await prisma.scanResult.create({ data: { scanId: scan.id, category, ...record } });
  }

  // The graph is derived from what the sections just stored. Its failure must not lose the scan.
  let graphBuilt = false;
  try {
    const connection = await prisma.salesforceConnection.findUnique({ where: { id: connectionId }, select: { graphSettings: true } });
    const result = await runGraphStage({
      source: new JsforceGraphSource(conn),
      inputs: new PrismaScanInputs(prisma, scan.id, extras),
      repository: new PrismaGraphRepository(prisma),
      connectionId,
      scanId: scan.id,
      settings: resolveGraphSettings(connection?.graphSettings),
      sections: sectionCoverage,
    });
    for (const r of result.records) await prisma.scanResult.create({ data: { scanId: scan.id, ...r } });
    if (result.degraded) degraded = true;
    graphBuilt = true;
  } catch (err) {
    console.warn("graph stage failed:", (err as Error).message);
    await prisma.scanResult.create({
      data: { scanId: scan.id, category: "graph", itemCount: 0, coverage: "degraded", coverageDetail: String((err as Error).message).slice(0, 300) },
    });
    degraded = true;
  }

  // Org Health reads the fresh graph. A graph that failed to build is not analysed (it would be stale), and a
  // health failure never fails the scan.
  if (graphBuilt) {
    try {
      await healthService.syncAfterScan(connectionId);
    } catch (err) {
      console.warn("org health sync after scan failed:", (err as Error).message);
    }
  }

  await prisma.scan.update({ where: { id: scan.id }, data: { status: degraded ? "completed_with_errors" : "completed", finishedAt: new Date() } });
  return scan.id;
}
