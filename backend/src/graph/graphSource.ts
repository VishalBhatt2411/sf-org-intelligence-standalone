import type { Connection } from "jsforce";
import type { RecordApi, RecordDescribe, RecordGlobal } from "./recordHierarchy";
import type { ApprovalProcessInput, DescribedObject, EmailAlertInput, PermissionSetMeta, ValidationRuleInput } from "./scanners/inputs";

// Live Salesforce reads the graph stage needs beyond what the main scan already stored. Behind an
// interface so the stage is tested with a fake and the scanners never see jsforce.

export type GlobalObject = { name: string; custom: boolean; queryable: boolean };
export type DescribeResult = { described: DescribedObject[]; failed: string[] };

// The object's Org-Wide Default. `supported` is false when the org does not report one (or the user may
// not read it); the reason is then shown instead of a made-up value.
export type SharingSettings = { supported: boolean; internalSharingModel: string | null; externalSharingModel: string | null; unavailableReason: string | null };

// Most objects one record-count request may cover, so a polymorphic lookup cannot fan out unbounded.
export const RECORD_COUNT_LIMIT = 25;
export type RecordCounts = { counts: Record<string, number | null>; truncated: boolean };

export interface GraphSource {
  // The org's own namespace prefix, or null when it has none.
  orgNamespace(): Promise<string | null>;
  listObjects(): Promise<GlobalObject[]>;
  // Per-object failures (no access, not describable) are reported in `failed`, not thrown.
  describe(names: string[]): Promise<DescribeResult>;
  permissionSetMeta(): Promise<PermissionSetMeta[]>;
  validationRules(): Promise<ValidationRuleInput[]>;
  emailAlerts(): Promise<EmailAlertInput[]>;
  approvalProcesses(): Promise<ApprovalProcessInput[]>;
  objectSharing(name: string): Promise<SharingSettings>;
  // Live COUNT() per object; one that cannot be counted is null, never zero.
  recordCounts(names: string[]): Promise<RecordCounts>;
  // Live record reads for Record mode; run as the connected user, so sharing and FLS apply.
  records(): RecordApi;
}

const DESCRIBE_CONCURRENCY = 8;

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type Page<T> = { records: T[]; done?: boolean; nextRecordsUrl?: string };

// Follows nextRecordsUrl until the result is exhausted. A queryMore failure mid-way throws, so the
// caller records the stage as failed instead of treating a truncated list as the whole org.
async function queryAll<T>(first: Page<T>, more: (locator: string) => Promise<Page<T>>): Promise<T[]> {
  const records = [...first.records];
  let page = first;
  while (!page.done && page.nextRecordsUrl) {
    page = await more(page.nextRecordsUrl);
    records.push(...page.records);
  }
  return records;
}

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);

export class JsforceGraphSource implements GraphSource {
  constructor(private readonly conn: Connection) {}

  private async soql<T extends Record<string, unknown>>(query: string): Promise<T[]> {
    return queryAll<T>((await this.conn.query<T>(query)) as Page<T>, async (l) => (await this.conn.queryMore<T>(l)) as Page<T>);
  }

  // Tooling queries are always listed field by field: Metadata and FullName cannot be selected for
  // more than one row.
  private async tooling<T extends Record<string, unknown>>(query: string): Promise<T[]> {
    return queryAll<T>((await this.conn.tooling.query<T>(query)) as Page<T>, async (l) => (await this.conn.tooling.queryMore<T>(l)) as Page<T>);
  }

  async orgNamespace(): Promise<string | null> {
    const rows = await this.soql<{ NamespacePrefix: string | null }>("SELECT NamespacePrefix FROM Organization LIMIT 1");
    return text(rows[0]?.NamespacePrefix);
  }

  async listObjects(): Promise<GlobalObject[]> {
    const global = await this.conn.describeGlobal();
    return global.sobjects.map((o) => ({ name: o.name, custom: Boolean(o.custom), queryable: Boolean(o.queryable) }));
  }

  async describe(names: string[]): Promise<DescribeResult> {
    const failed: string[] = [];
    const results = await mapPool<string, DescribedObject | null>(names, DESCRIBE_CONCURRENCY, async (name) => {
      try {
        const d = await this.conn.describe(name);
        return {
          name: d.name,
          fields: d.fields.map((f) => ({
            name: f.name,
            label: f.label,
            type: f.type,
            referenceTo: f.referenceTo && f.referenceTo.length > 0 ? (f.referenceTo.filter(Boolean) as string[]) : null,
            // describe reports relationshipOrder only for master-detail relationships.
            masterDetail: f.relationshipOrder !== null && f.relationshipOrder !== undefined,
            sfId: null,
            custom: Boolean(f.custom),
            required: f.relationshipOrder !== null && f.relationshipOrder !== undefined ? true : f.nillable === false,
            cascadeDelete: Boolean(f.cascadeDelete),
            relationshipName: text(f.relationshipName),
          })),
        };
      } catch (err) {
        console.warn(`graph: describe() failed for "${name}":`, (err as Error).message);
        failed.push(name);
        return null;
      }
    });
    return { described: results.filter((r): r is DescribedObject => r !== null), failed };
  }

  async permissionSetMeta(): Promise<PermissionSetMeta[]> {
    const rows = await this.soql<{ Name: string; Label: string | null; IsCustom: boolean; Type: string | null; NamespacePrefix: string | null }>(
      "SELECT Name, Label, IsCustom, Type, NamespacePrefix FROM PermissionSet"
    );
    return rows.map((r) => ({ name: r.Name, label: text(r.Label), isCustom: Boolean(r.IsCustom), type: text(r.Type), namespace: text(r.NamespacePrefix) }));
  }

  // ponytail: the Tooling field names below (ValidationRule.ValidationName, WorkflowAlert.DeveloperName,
  // EntityDefinition.QualifiedApiName) follow the documented schema but have not been run against a
  // live org yet; a mismatch surfaces as a failed stage with degraded coverage, not as bad data.
  async validationRules(): Promise<ValidationRuleInput[]> {
    const rows = await this.tooling<{
      Id: string;
      ValidationName: string;
      Active: boolean;
      Description: string | null;
      ErrorMessage: string | null;
      NamespacePrefix: string | null;
      EntityDefinition: { QualifiedApiName: string } | null;
    }>("SELECT Id, ValidationName, Active, Description, ErrorMessage, NamespacePrefix, EntityDefinition.QualifiedApiName FROM ValidationRule");
    return rows.flatMap((r) =>
      r.EntityDefinition?.QualifiedApiName
        ? [{ sfId: r.Id, objectName: r.EntityDefinition.QualifiedApiName, name: r.ValidationName, active: Boolean(r.Active), description: text(r.Description), errorMessage: text(r.ErrorMessage), namespace: text(r.NamespacePrefix) }]
        : []
    );
  }

  async emailAlerts(): Promise<EmailAlertInput[]> {
    const rows = await this.tooling<{
      Id: string;
      DeveloperName: string;
      Description: string | null;
      NamespacePrefix: string | null;
      EntityDefinition: { QualifiedApiName: string } | null;
    }>("SELECT Id, DeveloperName, Description, NamespacePrefix, EntityDefinition.QualifiedApiName FROM WorkflowAlert");
    return rows.flatMap((r) =>
      r.EntityDefinition?.QualifiedApiName
        ? [{ sfId: r.Id, objectName: r.EntityDefinition.QualifiedApiName, name: r.DeveloperName, description: text(r.Description), namespace: text(r.NamespacePrefix) }]
        : []
    );
  }

  // Approval processes live in ProcessDefinition (a regular sObject, not Tooling); TableEnumOrId is a
  // name for standard objects and an Id for custom ones, which the object index resolves.
  async approvalProcesses(): Promise<ApprovalProcessInput[]> {
    const rows = await this.soql<{
      Id: string;
      Name: string;
      DeveloperName: string;
      TableEnumOrId: string;
      State: string | null;
      Description: string | null;
      NamespacePrefix: string | null;
    }>("SELECT Id, Name, DeveloperName, TableEnumOrId, State, Description, NamespacePrefix FROM ProcessDefinition WHERE Type = 'Approval'");
    return rows.map((r) => ({ sfId: r.Id, objectName: r.TableEnumOrId, name: r.DeveloperName, label: r.Name, state: text(r.State), description: text(r.Description), namespace: text(r.NamespacePrefix) }));
  }

  // ponytail: EntityDefinition.InternalSharingModel / ExternalSharingModel follow the documented schema but
  // have not been run against a live org; a failure comes back as "unavailable", never as a guessed value.
  async objectSharing(name: string): Promise<SharingSettings> {
    try {
      const rows = await this.soql<{ InternalSharingModel: string | null; ExternalSharingModel: string | null }>(
        `SELECT InternalSharingModel, ExternalSharingModel FROM EntityDefinition WHERE QualifiedApiName = '${name.replace(/[^A-Za-z0-9_]/g, "")}' LIMIT 1`
      );
      const row = rows[0];
      if (!row) return { supported: false, internalSharingModel: null, externalSharingModel: null, unavailableReason: "This object does not report an Org-Wide Default." };
      return { supported: true, internalSharingModel: text(row.InternalSharingModel), externalSharingModel: text(row.ExternalSharingModel), unavailableReason: null };
    } catch (err) {
      console.warn(`graph: sharing settings failed for "${name}":`, (err as Error).message);
      return { supported: false, internalSharingModel: null, externalSharingModel: null, unavailableReason: "Sharing settings could not be read for this object." };
    }
  }

  async recordCounts(names: string[]): Promise<RecordCounts> {
    const wanted = names.slice(0, RECORD_COUNT_LIMIT);
    const counts: Record<string, number | null> = {};
    await mapPool(wanted, 5, async (name) => {
      try {
        const result = await this.conn.query<Record<string, unknown>>(`SELECT COUNT() FROM ${name.replace(/[^A-Za-z0-9_]/g, "")}`);
        counts[name] = result.totalSize;
      } catch (err) {
        console.warn(`graph: record count failed for "${name}":`, (err as Error).message);
        counts[name] = null;
      }
    });
    return { counts, truncated: names.length > wanted.length };
  }

  records(): RecordApi {
    const conn = this.conn;
    // describeGlobal and describe are cached per source (one request) so a record read costs each object once.
    let global: Promise<RecordGlobal[]> | null = null;
    const described = new Map<string, Promise<RecordDescribe>>();
    return {
      describeGlobal: () =>
        (global ??= conn.describeGlobal().then((g) => g.sobjects.map((o) => ({ name: o.name, keyPrefix: text(o.keyPrefix), queryable: Boolean(o.queryable) })))),
      describe: (name) => {
        let hit = described.get(name);
        if (!hit) {
          hit = conn.describe(name).then((d) => ({
            name: d.name,
            queryable: Boolean(d.queryable),
            fields: d.fields.map((f) => ({ name: f.name, type: f.type, nameField: Boolean(f.nameField), referenceTo: (f.referenceTo ?? []).filter(Boolean) as string[] })),
            childRelationships: d.childRelationships.map((r) => ({ childSObject: r.childSObject, field: r.field, relationshipName: text(r.relationshipName) })),
          }));
          described.set(name, hit);
        }
        return hit;
      },
      query: async (soql) => (await conn.query<Record<string, unknown>>(soql)).records,
    };
  }
}

// Test double: every method returns what it was given, and any can be made to fail.
export class FakeGraphSource implements GraphSource {
  namespace: string | null = null;
  objects: GlobalObject[] = [];
  described: DescribedObject[] = [];
  describeFailures: string[] = [];
  permissionSets: PermissionSetMeta[] = [];
  rules: ValidationRuleInput[] = [];
  alerts: EmailAlertInput[] = [];
  processes: ApprovalProcessInput[] = [];
  sharing: Record<string, SharingSettings> = {};
  counts: Record<string, number> = {};
  failing = new Set<keyof GraphSource>();
  describeCalls: string[][] = [];

  private guard(method: keyof GraphSource) {
    if (this.failing.has(method)) throw new Error(`${method} failed`);
  }

  async orgNamespace() {
    this.guard("orgNamespace");
    return this.namespace;
  }
  async listObjects() {
    this.guard("listObjects");
    return this.objects;
  }
  async describe(names: string[]) {
    this.guard("describe");
    this.describeCalls.push(names);
    const wanted = new Set(names.map((n) => n.toLowerCase()));
    return { described: this.described.filter((d) => wanted.has(d.name.toLowerCase())), failed: this.describeFailures.filter((n) => wanted.has(n.toLowerCase())) };
  }
  async permissionSetMeta() {
    this.guard("permissionSetMeta");
    return this.permissionSets;
  }
  async validationRules() {
    this.guard("validationRules");
    return this.rules;
  }
  async emailAlerts() {
    this.guard("emailAlerts");
    return this.alerts;
  }
  async approvalProcesses() {
    this.guard("approvalProcesses");
    return this.processes;
  }
  async objectSharing(name: string): Promise<SharingSettings> {
    this.guard("objectSharing");
    return this.sharing[name] ?? { supported: false, internalSharingModel: null, externalSharingModel: null, unavailableReason: "This object does not report an Org-Wide Default." };
  }
  async recordCounts(names: string[]): Promise<RecordCounts> {
    this.guard("recordCounts");
    const wanted = names.slice(0, RECORD_COUNT_LIMIT);
    return { counts: Object.fromEntries(wanted.map((n) => [n, this.counts[n] ?? null])), truncated: names.length > wanted.length };
  }
  recordApi: RecordApi = {
    describeGlobal: async () => [],
    describe: async (name) => ({ name, queryable: true, fields: [], childRelationships: [] }),
    query: async () => [],
  };
  records(): RecordApi {
    this.guard("records");
    return this.recordApi;
  }
}
