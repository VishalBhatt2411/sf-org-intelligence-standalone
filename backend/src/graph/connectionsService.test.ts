import { describe, expect, it } from "vitest";
import { ConnectionsService } from "./connectionsService";
import { GraphInputError, GraphNotFoundError } from "./errors";
import { edgeRow, keyOfRef, nodeRow, seed, type Ref } from "./graphTestKit";
import { InMemoryGraphRepository } from "./inMemoryGraphRepository";
import { typeKeyOf } from "./keys";

const C = "c1";
const account: Ref = ["CustomObject", "Account"];
const field = (n: string): Ref => ["CustomField", `Account.${n}`];
const cls = (n: string): Ref => ["ApexClass", n];
const HAS_FIELD = typeKeyOf("HAS_FIELD");
const REFERENCES = typeKeyOf("REFERENCES");

async function fixture(fieldCount = 5) {
  const repo = new InMemoryGraphRepository();
  const names = Array.from({ length: fieldCount }, (_, i) => `F${String(i).padStart(3, "0")}__c`);
  await seed(
    repo,
    C,
    [account, ...names.map((n) => [field(n)[0], field(n)[1], account] as const), cls("Billing"), cls("Invoicer")],
    [...names.map((n) => ({ type: "HAS_FIELD", from: account, to: field(n) })), { type: "REFERENCES", from: cls("Billing"), to: account }, { type: "REFERENCES", from: cls("Invoicer"), to: account }],
  );
  return { repo, service: new ConnectionsService(repo) };
}

describe("ConnectionsService", () => {
  it("lists outgoing rows with the neighbour's role, type label and exact total", async () => {
    const { service } = await fixture(3);
    const page = await service.connections(C, keyOfRef(account), { direction: "outgoing", edgeTypeKey: HAS_FIELD });
    expect(page.totalCount).toBe(3);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(page.isFiltered).toBe(false);
    expect(page.unavailableReason).toBeNull();
    expect(page.rows[0]).toMatchObject({ typeLabel: "Field", roleLabel: "Field Of", relationshipLabel: "Has Field", direction: "outgoing" });
    expect(page.rows.map((r) => r.apiName).sort()).toEqual(["Account.F000__c", "Account.F001__c", "Account.F002__c"]);
  });

  it("states incoming rows from the source's side", async () => {
    const { service } = await fixture(1);
    const page = await service.connections(C, keyOfRef(account), { direction: "incoming", edgeTypeKey: REFERENCES });
    expect(page.totalCount).toBe(2);
    expect(page.rows.map((r) => r.label).sort()).toEqual(["Billing", "Invoicer"]);
    expect(page.rows[0]).toMatchObject({ roleLabel: "References", typeLabel: "Apex Class", direction: "incoming" });
  });

  it("pages with a cursor and reports hasMore", async () => {
    const { service } = await fixture(5);
    const first = await service.connections(C, keyOfRef(account), { direction: "outgoing", edgeTypeKey: HAS_FIELD, pageSize: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const second = await service.connections(C, keyOfRef(account), { direction: "outgoing", edgeTypeKey: HAS_FIELD, pageSize: 2, cursor: first.nextCursor! });
    const third = await service.connections(C, keyOfRef(account), { direction: "outgoing", edgeTypeKey: HAS_FIELD, pageSize: 2, cursor: second.nextCursor! });
    expect(third.hasMore).toBe(false);
    const all = [...first.rows, ...second.rows, ...third.rows].map((r) => r.nodeKey);
    expect(new Set(all).size).toBe(5);
    expect(second.totalCount).toBe(5);
  });

  it("filters by name server-side and reports the filtered total", async () => {
    const { service } = await fixture(12);
    const page = await service.connections(C, keyOfRef(account), { direction: "outgoing", edgeTypeKey: HAS_FIELD, search: "F01" });
    expect(page.isFiltered).toBe(true);
    expect(page.totalCount).toBe(2);
    const none = await service.connections(C, keyOfRef(account), { direction: "outgoing", edgeTypeKey: HAS_FIELD, search: "zzz" });
    expect(none).toMatchObject({ rows: [], totalCount: 0, isFiltered: true, hasMore: false });
  });

  it("rejects a bad direction and an unknown node", async () => {
    const { service } = await fixture(1);
    await expect(service.connections(C, keyOfRef(account), { direction: "sideways", edgeTypeKey: HAS_FIELD })).rejects.toBeInstanceOf(GraphInputError);
    await expect(service.connections(C, "0".repeat(64), { direction: "outgoing", edgeTypeKey: HAS_FIELD })).rejects.toBeInstanceOf(GraphNotFoundError);
  });
});

describe("relationship fields and field keys", () => {
  async function schema() {
    const repo = new InMemoryGraphRepository();
    const lookup = { ...nodeRow("CustomField", "Account.Parent__c", account), attributes: { type: "Lookup", relationship: "Lookup", referenceTo: ["Account", "Contact"], nillable: true, relationshipName: "Parent__r", custom: true } };
    const md = { ...nodeRow("CustomField", "Account.Owner__c", account), attributes: { type: "MasterDetail", masterDetail: true, referenceTo: ["User"], nillable: false, custom: true } };
    const plain = nodeRow("CustomField", "Account.Notes__c", account);
    await repo.createNodes(C, "scan-1", [nodeRow("CustomObject", "Account"), lookup, md, plain]);
    await repo.createEdges(C, "scan-1", [lookup, md, plain].map((f) => edgeRow({ type: "HAS_FIELD", from: account, to: ["CustomField", f.fqn] })));
    return new ConnectionsService(repo);
  }

  it("lists only fields that reference other objects, with required from nillable", async () => {
    const rows = await (await schema()).relationshipFields(C, keyOfRef(account));
    expect(rows.map((r) => r.apiName)).toEqual(["Owner__c", "Parent__c"]);
    expect(rows[0]).toMatchObject({ masterDetail: true, required: true, referenceTo: ["User"] });
    expect(rows[1]).toMatchObject({ masterDetail: false, required: false, referenceTo: ["Account", "Contact"], relationshipName: "Parent__r" });
  });

  it("maps field api names to node keys and rejects an unknown node", async () => {
    const service = await schema();
    const keys = await service.fieldNodeKeys(C, "Account");
    expect(keys.get("Notes__c")).toBe(keyOfRef(["CustomField", "Account.Notes__c"]));
    expect((await service.fieldNodeKeys(C, "Missing")).size).toBe(0);
    await expect(service.relationshipFields(C, "0".repeat(64))).rejects.toBeInstanceOf(GraphNotFoundError);
  });
});
