import { describe, expect, it } from "vitest";
import type { RecordEdge, RecordNode } from "./graphApi";
import { deriveRecordHierarchy, hierarchyCount, orgWideDefaultRows, recordOverviewRows } from "./recordPanelModel";
import { RECORD_CHILD_EDGE, RECORD_PARENT_EDGE } from "./recordRelationshipView";

const rec = (objectApiName: string, id: string, label: string): RecordNode => ({ nodeKey: `Record::${objectApiName}::${id}`, typeKey: `SalesforceRecord.${objectApiName}`, label, objectApiName, recordId: id });
const parent = (from: RecordNode, to: RecordNode, via: string | null): RecordEdge => ({ edgeKey: `${from.nodeKey}>${to.nodeKey}>${via}`, typeKey: RECORD_PARENT_EDGE, source: from.nodeKey, target: to.nodeKey, viaField: via });
const child = (from: RecordNode, to: RecordNode, via: string | null): RecordEdge => ({ edgeKey: `${from.nodeKey}>${to.nodeKey}>${via}`, typeKey: RECORD_CHILD_EDGE, source: from.nodeKey, target: to.nodeKey, viaField: via });

const acme = rec("Account", "001A", "Acme");
const pat = rec("User", "005A", "Pat Owner");
const globex = rec("Account", "001B", "Globex");
const casey = rec("Contact", "003A", "Casey");
const dana = rec("Contact", "003B", "Dana");
const deal = rec("Opportunity", "006A", "Big Deal");

describe("deriveRecordHierarchy", () => {
  it("lists business parents, skipping the system audit lookups", () => {
    const h = deriveRecordHierarchy({ nodes: [acme, pat, globex], edges: [parent(acme, pat, "OwnerId"), parent(acme, pat, "CreatedById"), parent(acme, pat, "LastModifiedById"), parent(acme, globex, "ParentId")], hasMore: false }, acme.nodeKey);
    expect(h.parentRows).toEqual([{ key: `ParentId::${globex.nodeKey}`, nodeKey: globex.nodeKey, label: "Globex", typeLabel: "Account", relationshipLabel: "ParentId" }]);
  });

  it("groups children by object and relationship field with counts", () => {
    const h = deriveRecordHierarchy(
      { nodes: [acme, casey, dana, deal], edges: [child(acme, casey, "AccountId"), child(acme, dana, "AccountId"), child(acme, dana, "Billing__c"), child(acme, deal, "AccountId")], hasMore: true },
      acme.nodeKey,
    );
    expect(h.childRows).toEqual([
      { key: "SalesforceRecord.Contact::AccountId", typeLabel: "Contact", relationshipLabel: "AccountId", count: 2 },
      { key: "SalesforceRecord.Contact::Billing__c", typeLabel: "Contact", relationshipLabel: "Billing__c", count: 1 },
      { key: "SalesforceRecord.Opportunity::AccountId", typeLabel: "Opportunity", relationshipLabel: "AccountId", count: 1 },
    ]);
    expect(h.hasMore).toBe(true);
    expect(hierarchyCount(h)).toBe(4);
  });

  it("counts parents plus every child and ignores edges not leaving the centre or missing a node", () => {
    const h = deriveRecordHierarchy({ nodes: [acme, globex, casey], edges: [parent(acme, globex, null), child(acme, casey, null), parent(casey, globex, "AccountId"), child(acme, rec("Contact", "003Z", "Ghost"), "AccountId")], hasMore: false }, acme.nodeKey);
    expect(h.parentRows.map((r) => r.relationshipLabel)).toEqual(["Parent relationship"]);
    expect(h.childRows.map((r) => r.relationshipLabel)).toEqual(["Child relationship"]);
    expect(hierarchyCount(h)).toBe(2);
  });

  it("is empty for a record with no business neighbours", () => {
    const h = deriveRecordHierarchy({ nodes: [acme, pat], edges: [parent(acme, pat, "OwnerId")], hasMore: false }, acme.nodeKey);
    expect(h).toEqual({ parentRows: [], childRows: [], hasMore: false });
    expect(hierarchyCount(h)).toBe(0);
  });
});

describe("recordOverviewRows", () => {
  it("shows identity always and owner and dates only when known", () => {
    expect(recordOverviewRows(acme, null)).toEqual([
      ["Name", "Acme"],
      ["Object", "Account"],
      ["Record Id", "001A"],
    ]);
    const rows = recordOverviewRows(acme, { ownerName: "Pat Owner", createdDate: "2026-01-01T00:00:00.000Z", lastModifiedDate: "2026-02-01T00:00:00.000Z" });
    expect(rows.map(([k]) => k)).toEqual(["Name", "Object", "Record Id", "Owner", "Created", "Last Modified"]);
    expect(rows[3][1]).toBe("Pat Owner");
  });
});

describe("orgWideDefaultRows", () => {
  it("uses the Object mode wording and placeholders", () => {
    expect(orgWideDefaultRows({ supported: true, internalSharingModel: "Private", externalSharingModel: null, unavailableReason: null })).toEqual([
      ["Internal Sharing Model", "Private"],
      ["External Sharing Model", "Not enabled"],
    ]);
    expect(orgWideDefaultRows({ supported: true, internalSharingModel: null, externalSharingModel: "Read", unavailableReason: null })[0]).toEqual(["Internal Sharing Model", "—"]);
    expect(orgWideDefaultRows({ supported: false, internalSharingModel: null, externalSharingModel: null, unavailableReason: "No access" })).toEqual([]);
    expect(orgWideDefaultRows(null)).toEqual([]);
  });
});
