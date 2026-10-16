// Record mode's Sharing section (port of native OI_RecordSharingService): a live read of who has access to ONE
// record and why, plus whether it is locked by a pending approval. Never persisted, never cached as fact: a
// record's sharing must never be presented as a possibly-stale answer. Runs as the connected user, so only the
// share rows that user may see come back.
//
// Native reads the lock from Approval.isLocked, which is Apex-only. Over the API the closest platform fact is a
// Pending ProcessInstance on the record (approval processes lock the record while pending). A ProcessInstance
// that cannot be read reports "not locked", the same way native treats its own unavailable lock check.

import { describeAccessibleObject, validateRecordIdForObject, type RecordApi, type RecordDescribe } from "./recordHierarchy";
import type { SharingSettings } from "./graphSource";

export const MAX_SHARE_ROWS = 200;
const USER_KEY_PREFIX = "005";

export type ShareRow = { userOrGroupId: string | null; userOrGroupLabel: string | null; accessLevel: string | null; rowCause: string | null };

export type RecordSharing = {
  // False when the object has no <Object>Share table: "not applicable", which reads differently from "nobody".
  supportsSharing: boolean;
  // Explains a false supportsSharing, or a true one with zero rows; never a silent empty list.
  coverageNote: string | null;
  shareRows: ShareRow[];
  truncated: boolean;
  isLockedByApproval: boolean;
  pendingApprovalDetail: string | null;
  orgWideDefault: SharingSettings | null;
};

type ShareTable = { objectApiName: string; parentField: string; accessLevelField: string };

export const NO_SHARE_TABLE_NOTE =
  "This object has no independent sharing table — its access is controlled entirely by its parent record or by the object's org-wide default.";
export const NO_VISIBLE_ROWS_NOTE = "No share rows are visible for this record with your current access.";

const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const quoted = (ids: Iterable<string>) => [...ids].map((id) => `'${id}'`).join(", ");

// Standard system groups ship with a blank Name; only DeveloperName is set. Falls back so a label never reads "null (...)".
export function buildGroupLabel(name: string | null, developerName: string | null, type: string | null): string {
  const label = name && name.trim() ? name : (developerName ?? "Group");
  return type ? `${label} (${type})` : label;
}

export function describeApprovalDetail(submitter: string | null, approver: string | null): string | null {
  if (!submitter && !approver) return null;
  if (!approver) return `Submitted by ${submitter}, awaiting the next approver.`;
  if (!submitter) return `Awaiting approval from ${approver}.`;
  return `Submitted by ${submitter}, awaiting approval from ${approver}.`;
}

// Standard objects share through <Object>Share (AccountShare); custom objects through <Name>__Share (Widget__c ->
// Widget__Share). Native appends "Share" to every name, which finds no table for a custom object and reports it
// "not applicable"; the platform's actual custom-object convention is used here instead.
export function shareTableName(objectApiName: string): string {
  return objectApiName.endsWith("__c") ? `${objectApiName.slice(0, -3)}__Share` : `${objectApiName}Share`;
}

export class RecordSharingService {
  constructor(
    private readonly api: RecordApi,
    // The object's Org-Wide Default, the same read the Object panel's Sharing Settings section uses.
    private readonly orgWideDefault: (objectApiName: string) => Promise<SharingSettings>
  ) {}

  async sharing(objectApiName: string, recordId: string): Promise<RecordSharing> {
    const describe = await describeAccessibleObject(this.api, objectApiName);
    await validateRecordIdForObject(this.api, describe, recordId);

    const [shareTable, lock, orgWideDefault] = await Promise.all([this.resolveShareTable(describe), this.approvalLock(recordId), this.readOrgWideDefault(describe.name)]);
    const base = { isLockedByApproval: lock.locked, pendingApprovalDetail: lock.detail, orgWideDefault };
    if (!shareTable) return { supportsSharing: false, coverageNote: NO_SHARE_TABLE_NOTE, shareRows: [], truncated: false, ...base };

    const raw = await this.queryShareRows(shareTable, recordId);
    const truncated = raw.length > MAX_SHARE_ROWS;
    const bounded = raw.slice(0, MAX_SHARE_ROWS);
    const labels = await this.principalLabels(bounded.map((r) => text(r.UserOrGroupId)).filter((id): id is string => id !== null));
    const shareRows = bounded.map((r) => {
      const id = text(r.UserOrGroupId);
      return { userOrGroupId: id, userOrGroupLabel: id ? (labels.get(id) ?? null) : null, accessLevel: text(r[shareTable.accessLevelField]), rowCause: text(r.RowCause) };
    });
    return { supportsSharing: true, coverageNote: shareRows.length === 0 ? NO_VISIBLE_ROWS_NOTE : null, shareRows, truncated, ...base };
  }

  // A custom object's share table uses ParentId and AccessLevel; a standard object's uses <Object>Id and
  // <Object>AccessLevel (AccountId, AccountAccessLevel). The platform's documented convention, with the same
  // defensive fallbacks as native; a share table this does not fit is "not applicable", never a crash.
  private async resolveShareTable(describe: RecordDescribe): Promise<ShareTable | null> {
    const shareName = shareTableName(describe.name);
    const global = (await this.api.describeGlobal()).find((o) => o.name.toLowerCase() === shareName.toLowerCase());
    if (!global?.queryable) return null;
    let shareDescribe: RecordDescribe;
    try {
      shareDescribe = await this.api.describe(global.name);
    } catch (err) {
      console.warn(`records: share table ${global.name} not describable:`, (err as Error).message);
      return null;
    }
    const has = new Set(shareDescribe.fields.map((f) => f.name));
    const custom = describe.custom ?? describe.name.endsWith("__c");
    let parentField: string | null = custom ? "ParentId" : `${describe.name}Id`;
    if (!has.has(parentField)) parentField = has.has("ParentId") ? "ParentId" : null;
    let accessLevelField: string | null = custom ? "AccessLevel" : `${describe.name}AccessLevel`;
    if (!has.has(accessLevelField)) accessLevelField = has.has("AccessLevel") ? "AccessLevel" : null;
    if (!parentField || !accessLevelField || !has.has("UserOrGroupId") || !has.has("RowCause")) return null;
    return { objectApiName: shareDescribe.name, parentField, accessLevelField };
  }

  private async queryShareRows(table: ShareTable, recordId: string): Promise<Array<Record<string, unknown>>> {
    try {
      return await this.api.query(`SELECT UserOrGroupId, ${table.accessLevelField}, RowCause FROM ${table.objectApiName} WHERE ${table.parentField} = '${recordId}' LIMIT ${MAX_SHARE_ROWS + 1}`);
    } catch (err) {
      // A describe-listed share table can still be unqueryable in practice (edition or feature gating).
      console.warn(`records: share rows of ${table.objectApiName} unreadable:`, (err as Error).message);
      return [];
    }
  }

  // One query per principal type (User, Group/Queue), never one per row. An unreadable principal keeps its Id.
  private async principalLabels(ids: string[]): Promise<Map<string, string>> {
    const users = new Set(ids.filter((id) => id.startsWith(USER_KEY_PREFIX)));
    const groups = new Set(ids.filter((id) => !id.startsWith(USER_KEY_PREFIX)));
    const labels = new Map<string, string>();
    const read = async (soql: string, label: (r: Record<string, unknown>) => string | null) => {
      try {
        for (const row of await this.api.query(soql)) {
          const value = label(row);
          if (value) labels.set(String(row.Id), value);
        }
      } catch (err) {
        console.warn("records: share principal labels unreadable:", (err as Error).message);
      }
    };
    await Promise.all([
      users.size ? read(`SELECT Id, Name FROM User WHERE Id IN (${quoted(users)})`, (r) => text(r.Name)) : null,
      groups.size ? read(`SELECT Id, Name, DeveloperName, Type FROM Group WHERE Id IN (${quoted(groups)})`, (r) => buildGroupLabel(text(r.Name), text(r.DeveloperName), text(r.Type))) : null,
    ]);
    return labels;
  }

  private async approvalLock(recordId: string): Promise<{ locked: boolean; detail: string | null }> {
    try {
      const rows = await this.api.query(
        `SELECT Id, SubmittedBy.Name, (SELECT Actor.Name FROM Workitems LIMIT 1) FROM ProcessInstance WHERE TargetObjectId = '${recordId}' AND Status = 'Pending' ORDER BY CreatedDate DESC LIMIT 1`
      );
      const current = rows[0];
      if (!current) return { locked: false, detail: null };
      const submitter = text((current.SubmittedBy as { Name?: unknown } | null | undefined)?.Name);
      const workitems = (current.Workitems as { records?: Array<{ Actor?: { Name?: unknown } | null }> } | null | undefined)?.records ?? [];
      const approver = text(workitems[0]?.Actor?.Name);
      return { locked: true, detail: describeApprovalDetail(submitter, approver) };
    } catch (err) {
      console.warn("records: approval status unreadable:", (err as Error).message);
      return { locked: false, detail: null };
    }
  }

  private async readOrgWideDefault(objectApiName: string): Promise<SharingSettings | null> {
    try {
      return await this.orgWideDefault(objectApiName);
    } catch (err) {
      console.warn(`records: org-wide default of ${objectApiName} unreadable:`, (err as Error).message);
      return { supported: false, internalSharingModel: null, externalSharingModel: null, unavailableReason: "Sharing settings could not be read for this object." };
    }
  }
}
