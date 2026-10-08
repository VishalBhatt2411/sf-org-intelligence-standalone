import type { Connection } from "jsforce";

// The live Salesforce reads behind the Security, Data and Storage sections. Behind an interface so the
// sections are tested with a fake and never see jsforce. A method throws when it cannot read what it was
// asked for; the section catches that and lists it under "unavailable" instead of zero-filling it.

// Permission flags that make a permission set "elevated" (each is a boolean column on PermissionSet).
export const ELEVATED_FLAGS = [
  "PermissionsModifyAllData",
  "PermissionsViewAllData",
  "PermissionsManageUsers",
  "PermissionsAuthorApex",
  "PermissionsCustomizeApplication",
  "PermissionsManageProfilesPermissionsets",
] as const;
export type ElevatedFlag = (typeof ELEVATED_FLAGS)[number];

export type SecuritySet = {
  id: string;
  name: string;
  label: string;
  namespace: string | null;
  // True when the set is the hidden one behind a profile; `label` then holds the profile's name.
  profileOwned: boolean;
  flags: ElevatedFlag[];
};

export type BroadGrant = { permissionSetId: string; modifyAll: number; viewAll: number };
export type SensitiveGrant = { permissionSetId: string; object: string; modifyAll: boolean; viewAll: boolean; delete: boolean };
export type LimitValue = { max: number; remaining: number };

export type ObjectProfile = {
  object: string;
  total: number;
  stale: number;
  // One row per sampled record; only the requested fields that exist on the object are present.
  sample: Array<Record<string, string | null>>;
  // Requested fields the object does not have (or the user cannot read).
  missingFields: string[];
};

export interface HealthSource {
  // Custom permission sets and custom profiles. Salesforce-supplied ones are not returned.
  securitySets(limit: number): Promise<{ sets: SecuritySet[]; truncated: boolean }>;
  // Objects with View All / Modify All Records, per permission set.
  broadGrants(): Promise<BroadGrant[]>;
  // View All / Modify All / Delete on the given objects, per permission set.
  sensitiveGrants(objects: string[], limit: number): Promise<{ grants: SensitiveGrant[]; truncated: boolean }>;
  // Users assigned to each permission set.
  assignmentCounts(): Promise<Map<string, number>>;
  // Exact record counts, plus a bounded sample of field values.
  objectProfile(object: string, fields: string[], staleBefore: Date, sampleLimit: number): Promise<ObjectProfile>;
  // The org's REST limits, by name.
  limits(): Promise<Record<string, LimitValue>>;
}

type Page<T> = { records: T[]; done?: boolean; nextRecordsUrl?: string; totalSize?: number };

async function queryAll<T>(first: Page<T>, more: (locator: string) => Promise<Page<T>>, max: number): Promise<{ records: T[]; truncated: boolean }> {
  const records = [...first.records];
  let page = first;
  while (!page.done && page.nextRecordsUrl && records.length < max) {
    page = await more(page.nextRecordsUrl);
    records.push(...page.records);
  }
  return { records: records.slice(0, max), truncated: records.length > max || Boolean(!page.done && page.nextRecordsUrl) };
}

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const asText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
// SOQL literal for an API name or object name: identifiers only, so nothing needs escaping.
const ident = (name: string): string => {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`Not a valid API name: ${name}`);
  return name;
};

export class JsforceHealthSource implements HealthSource {
  constructor(private readonly conn: Connection) {}

  private async soql<T extends Record<string, unknown>>(query: string, max = Number.MAX_SAFE_INTEGER) {
    return queryAll<T>((await this.conn.query<T>(query)) as Page<T>, async (l) => (await this.conn.queryMore<T>(l)) as Page<T>, max);
  }

  // ponytail: the PermissionSet / ObjectPermissions / PermissionSetAssignment field names below follow the
  // documented schema but have not been run against a live org; a mismatch makes the section report the
  // read as unavailable rather than showing wrong numbers.
  async securitySets(limit: number) {
    const flags = ELEVATED_FLAGS.join(", ");
    const { records, truncated } = await this.soql<Record<string, unknown>>(
      `SELECT Id, Name, Label, NamespacePrefix, IsOwnedByProfile, Profile.Name, ${flags} FROM PermissionSet WHERE IsCustom = true ORDER BY Name`,
      limit,
    );
    const sets = records.map((r): SecuritySet => {
      const profile = (r.Profile as { Name?: string } | null | undefined)?.Name;
      return {
        id: String(r.Id),
        name: String(r.Name),
        label: text(profile) ?? text(r.Label) ?? String(r.Name),
        namespace: text(r.NamespacePrefix),
        profileOwned: Boolean(r.IsOwnedByProfile),
        flags: ELEVATED_FLAGS.filter((f) => r[f] === true),
      };
    });
    return { sets, truncated };
  }

  async broadGrants(): Promise<BroadGrant[]> {
    const agg = async (flag: string) => {
      const { records } = await this.soql<{ ParentId: string; n: number }>(`SELECT ParentId, COUNT(Id) n FROM ObjectPermissions WHERE ${flag} = true GROUP BY ParentId`);
      return new Map(records.map((r) => [String(r.ParentId), Number(r.n)] as const));
    };
    const [modify, view] = await Promise.all([agg("PermissionsModifyAllRecords"), agg("PermissionsViewAllRecords")]);
    return [...new Set([...modify.keys(), ...view.keys()])].map((id) => ({ permissionSetId: id, modifyAll: modify.get(id) ?? 0, viewAll: view.get(id) ?? 0 }));
  }

  async sensitiveGrants(objects: string[], limit: number) {
    if (objects.length === 0) return { grants: [], truncated: false };
    const list = objects.map((o) => `'${ident(o)}'`).join(", ");
    const { records, truncated } = await this.soql<Record<string, unknown>>(
      `SELECT ParentId, SobjectType, PermissionsModifyAllRecords, PermissionsViewAllRecords, PermissionsDelete FROM ObjectPermissions ` +
        `WHERE SobjectType IN (${list}) AND (PermissionsModifyAllRecords = true OR PermissionsViewAllRecords = true OR PermissionsDelete = true)`,
      limit,
    );
    return {
      grants: records.map((r) => ({
        permissionSetId: String(r.ParentId),
        object: String(r.SobjectType),
        modifyAll: r.PermissionsModifyAllRecords === true,
        viewAll: r.PermissionsViewAllRecords === true,
        delete: r.PermissionsDelete === true,
      })),
      truncated,
    };
  }

  async assignmentCounts(): Promise<Map<string, number>> {
    const { records } = await this.soql<{ PermissionSetId: string; n: number }>("SELECT PermissionSetId, COUNT(AssigneeId) n FROM PermissionSetAssignment GROUP BY PermissionSetId");
    return new Map(records.map((r) => [String(r.PermissionSetId), Number(r.n)] as const));
  }

  async objectProfile(object: string, fields: string[], staleBefore: Date, sampleLimit: number): Promise<ObjectProfile> {
    const name = ident(object);
    const described = await this.conn.describe(name);
    if (!described.queryable) throw new Error(`${name} is not queryable`);
    const known = new Set(described.fields.map((f) => f.name));
    const present = [...new Set(fields)].filter((f) => known.has(f));
    const missingFields = [...new Set(fields)].filter((f) => !known.has(f));
    // Exact counts first (they do not depend on the sample), then a deterministic sample ordered by Id.
    const count = async (where = "") => ((await this.conn.query(`SELECT COUNT() FROM ${name}${where}`)) as Page<unknown>).totalSize ?? 0;
    const [total, stale] = await Promise.all([count(), count(` WHERE LastModifiedDate < ${staleBefore.toISOString()}`)]);
    const select = ["Id", ...present.map(ident)].join(", ");
    const { records } = await this.soql<Record<string, unknown>>(`SELECT ${select} FROM ${name} ORDER BY Id LIMIT ${Math.max(1, Math.floor(sampleLimit))}`, sampleLimit);
    return { object: name, total, stale, sample: records.map((r) => Object.fromEntries(present.map((f) => [f, asText(r[f])]))), missingFields };
  }

  async limits(): Promise<Record<string, LimitValue>> {
    const raw = await this.conn.request<Record<string, { Max?: number; Remaining?: number }>>(`/services/data/v${this.conn.version}/limits`);
    const out: Record<string, LimitValue> = {};
    for (const [key, v] of Object.entries(raw ?? {})) {
      if (v && typeof v.Max === "number" && typeof v.Remaining === "number") out[key] = { max: v.Max, remaining: v.Remaining };
    }
    return out;
  }
}
