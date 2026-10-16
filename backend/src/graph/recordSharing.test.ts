import { describe, expect, it } from "vitest";
import type { SharingSettings } from "./graphSource";
import { RecordInputError, RecordNotFoundError, type RecordApi, type RecordDescribe, type RecordGlobal } from "./recordHierarchy";
import { MAX_SHARE_ROWS, NO_SHARE_TABLE_NOTE, NO_VISIBLE_ROWS_NOTE, RecordSharingService, buildGroupLabel, shareTableName, describeApprovalDetail } from "./recordSharing";

const ACCOUNT = "001000000000001AAA";
const USER = "005000000000001AAA";
const GROUP = "00G000000000001AAA";
const WIDGET = "a01000000000001AAA";
const NOTE = "002000000000001AAA";

const globals: RecordGlobal[] = [
  { name: "Account", keyPrefix: "001", queryable: true },
  { name: "AccountShare", keyPrefix: null, queryable: true },
  { name: "Widget__c", keyPrefix: "a01", queryable: true },
  { name: "Widget__Share", keyPrefix: null, queryable: true },
  { name: "Note", keyPrefix: "002", queryable: true },
];

const field = (name: string) => ({ name, type: "string", nameField: false, referenceTo: [] });
const describes: Record<string, RecordDescribe> = {
  Account: { name: "Account", queryable: true, custom: false, fields: [field("Id")], childRelationships: [] },
  AccountShare: { name: "AccountShare", queryable: true, fields: ["Id", "AccountId", "AccountAccessLevel", "UserOrGroupId", "RowCause"].map(field), childRelationships: [] },
  Widget__c: { name: "Widget__c", queryable: true, custom: true, fields: [field("Id")], childRelationships: [] },
  Widget__Share: { name: "Widget__Share", queryable: true, fields: ["Id", "ParentId", "AccessLevel", "UserOrGroupId", "RowCause"].map(field), childRelationships: [] },
  Note: { name: "Note", queryable: true, custom: false, fields: [field("Id")], childRelationships: [] },
};

type Query = (soql: string) => Array<Record<string, unknown>> | Error;

function fakeApi(query: Query): RecordApi & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    describeGlobal: async () => globals,
    describe: async (name) => {
      if (!describes[name]) throw new Error(`no describe for ${name}`);
      return describes[name];
    },
    query: async (soql) => {
      queries.push(soql);
      const out = query(soql);
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

const owd: SharingSettings = { supported: true, internalSharingModel: "Private", externalSharingModel: "Private", unavailableReason: null };
const service = (api: RecordApi, read: (n: string) => Promise<SharingSettings> = async () => owd) => new RecordSharingService(api, read);

const standard: Query = (soql) => {
  if (soql.includes("FROM AccountShare")) return [
    { UserOrGroupId: USER, AccountAccessLevel: "All", RowCause: "Owner" },
    { UserOrGroupId: GROUP, AccountAccessLevel: "Read", RowCause: "Manual" },
  ];
  if (soql.includes("FROM User WHERE Id IN")) return [{ Id: USER, Name: "Pat Owner" }];
  if (soql.includes("FROM Group WHERE Id IN")) return [{ Id: GROUP, Name: null, DeveloperName: "AllInternalUsers", Type: "Organization" }];
  if (soql.includes("FROM ProcessInstance")) return [];
  return [];
};

describe("RecordSharingService", () => {
  it("reads the standard share table with resolved principal labels and the org-wide default", async () => {
    const api = fakeApi(standard);
    const result = await service(api).sharing("Account", ACCOUNT);
    expect(result).toEqual({
      supportsSharing: true,
      coverageNote: null,
      shareRows: [
        { userOrGroupId: USER, userOrGroupLabel: "Pat Owner", accessLevel: "All", rowCause: "Owner" },
        { userOrGroupId: GROUP, userOrGroupLabel: "AllInternalUsers (Organization)", accessLevel: "Read", rowCause: "Manual" },
      ],
      truncated: false,
      isLockedByApproval: false,
      pendingApprovalDetail: null,
      orgWideDefault: owd,
    });
    expect(api.queries).toContain(`SELECT UserOrGroupId, AccountAccessLevel, RowCause FROM AccountShare WHERE AccountId = '${ACCOUNT}' LIMIT ${MAX_SHARE_ROWS + 1}`);
  });

  it("reports an object without a share table as not applicable, never as nobody", async () => {
    const result = await service(fakeApi(standard)).sharing("Note", NOTE);
    expect(result.supportsSharing).toBe(false);
    expect(result.coverageNote).toBe(NO_SHARE_TABLE_NOTE);
    expect(result.shareRows).toEqual([]);
    expect(result.orgWideDefault).toEqual(owd);
  });

  it("finds a custom object's <Name>__Share table and reads it by ParentId and AccessLevel", async () => {
    const api = fakeApi(() => []);
    const result = await service(api).sharing("Widget__c", WIDGET);
    expect(result.supportsSharing).toBe(true);
    expect(result.coverageNote).toBe(NO_VISIBLE_ROWS_NOTE);
    expect(api.queries).toContain(`SELECT UserOrGroupId, AccessLevel, RowCause FROM Widget__Share WHERE ParentId = '${WIDGET}' LIMIT ${MAX_SHARE_ROWS + 1}`);
  });

  it("names share tables by the platform convention", () => {
    expect(shareTableName("Account")).toBe("AccountShare");
    expect(shareTableName("Widget__c")).toBe("Widget__Share");
    expect(shareTableName("ns__Widget__c")).toBe("ns__Widget__Share");
  });

  it("bounds the rows and flags truncation", async () => {
    const rows = Array.from({ length: MAX_SHARE_ROWS + 1 }, () => ({ UserOrGroupId: USER, AccountAccessLevel: "Read", RowCause: "Manual" }));
    const result = await service(fakeApi((soql) => (soql.includes("FROM AccountShare") ? rows : standard(soql)))).sharing("Account", ACCOUNT);
    expect(result.shareRows).toHaveLength(MAX_SHARE_ROWS);
    expect(result.truncated).toBe(true);
  });

  it("treats an unreadable share table as zero visible rows and keeps Ids when labels are unreadable", async () => {
    const failing = await service(fakeApi((soql) => (soql.includes("FROM AccountShare") ? new Error("denied") : standard(soql)))).sharing("Account", ACCOUNT);
    expect(failing.shareRows).toEqual([]);
    expect(failing.coverageNote).toBe(NO_VISIBLE_ROWS_NOTE);

    const unlabeled = await service(fakeApi((soql) => (soql.includes("FROM User") || soql.includes("FROM Group") ? new Error("denied") : standard(soql)))).sharing("Account", ACCOUNT);
    expect(unlabeled.shareRows.map((r) => [r.userOrGroupId, r.userOrGroupLabel])).toEqual([[USER, null], [GROUP, null]]);
  });

  it("reports a pending approval as a lock with its detail", async () => {
    const pending: Query = (soql) =>
      soql.includes("FROM ProcessInstance") ? [{ Id: "04g", SubmittedBy: { Name: "Sam Sender" }, Workitems: { records: [{ Actor: { Name: "Alex Approver" } }] } }] : standard(soql);
    const result = await service(fakeApi(pending)).sharing("Account", ACCOUNT);
    expect(result.isLockedByApproval).toBe(true);
    expect(result.pendingApprovalDetail).toBe("Submitted by Sam Sender, awaiting approval from Alex Approver.");
  });

  it("treats an unreadable approval status as unlocked and an unreadable org-wide default as unsupported", async () => {
    const api = fakeApi((soql) => (soql.includes("FROM ProcessInstance") ? new Error("no access") : standard(soql)));
    const result = await service(api, async () => {
      throw new Error("metadata down");
    }).sharing("Account", ACCOUNT);
    expect(result.isLockedByApproval).toBe(false);
    expect(result.pendingApprovalDetail).toBeNull();
    expect(result.orgWideDefault?.supported).toBe(false);
    expect(result.orgWideDefault?.unavailableReason).toBeTruthy();
  });

  it("validates the object and the record Id the same way as the fragment", async () => {
    const api = fakeApi(standard);
    await expect(service(api).sharing("Missing", ACCOUNT)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(service(api).sharing("Bad Name", ACCOUNT)).rejects.toBeInstanceOf(RecordInputError);
    await expect(service(api).sharing("Account", "not-an-id")).rejects.toBeInstanceOf(RecordInputError);
    await expect(service(api).sharing("Account", NOTE)).rejects.toBeInstanceOf(RecordInputError);
    expect(api.queries).toEqual([]);
  });
});

describe("labels", () => {
  it("builds group labels without ever reading null", () => {
    expect(buildGroupLabel("Sales", "Sales_Team", "Regular")).toBe("Sales (Regular)");
    expect(buildGroupLabel(" ", "AllInternalUsers", "Organization")).toBe("AllInternalUsers (Organization)");
    expect(buildGroupLabel(null, null, null)).toBe("Group");
  });

  it("describes pending approvals like native", () => {
    expect(describeApprovalDetail(null, null)).toBeNull();
    expect(describeApprovalDetail("Sam", null)).toBe("Submitted by Sam, awaiting the next approver.");
    expect(describeApprovalDetail(null, "Alex")).toBe("Awaiting approval from Alex.");
    expect(describeApprovalDetail("Sam", "Alex")).toBe("Submitted by Sam, awaiting approval from Alex.");
  });
});
