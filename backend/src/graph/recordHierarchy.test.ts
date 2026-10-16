import { describe, expect, it } from "vitest";
import {
  MAX_CHILDREN_PER_RELATIONSHIP,
  RecordInputError,
  RecordNotFoundError,
  RecordService,
  likeLiteral,
  parseRecordNodeKey,
  recordNodeKey,
  type RecordApi,
  type RecordDescribe,
  type RecordGlobal,
} from "./recordHierarchy";

const ACCOUNT = "001000000000001AAA";
const OWNER = "005000000000001AAA";
const CONTACT = "003000000000001AAA";

const globals: RecordGlobal[] = [
  { name: "Account", keyPrefix: "001", queryable: true },
  { name: "User", keyPrefix: "005", queryable: true },
  { name: "Contact", keyPrefix: "003", queryable: true },
  { name: "Hidden", keyPrefix: "a00", queryable: false },
];

const describes: Record<string, RecordDescribe> = {
  Account: {
    name: "Account",
    queryable: true,
    fields: [
      { name: "Id", type: "id", nameField: false, referenceTo: [] },
      { name: "Name", type: "string", nameField: true, referenceTo: [] },
      { name: "OwnerId", type: "reference", nameField: false, referenceTo: ["User"] },
      { name: "CreatedDate", type: "datetime", nameField: false, referenceTo: [] },
      { name: "LastModifiedDate", type: "datetime", nameField: false, referenceTo: [] },
    ],
    childRelationships: [
      { childSObject: "Contact", field: "AccountId", relationshipName: "Contacts" },
      { childSObject: "Hidden", field: "AccountId", relationshipName: "Hiddens" },
      { childSObject: "Contact", field: "ReportsToId", relationshipName: null },
    ],
  },
  User: { name: "User", queryable: true, fields: [{ name: "Name", type: "string", nameField: true, referenceTo: [] }], childRelationships: [] },
  Contact: { name: "Contact", queryable: true, fields: [{ name: "Name", type: "string", nameField: true, referenceTo: [] }], childRelationships: [] },
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

const standard: Query = (soql) => {
  if (soql.includes("FROM Account WHERE Id =") && soql.includes("(SELECT Id FROM Contacts")) return [{ Id: ACCOUNT, Contacts: { totalSize: 1, records: [{ Id: CONTACT }] } }];
  if (soql.includes("FROM Account WHERE Id =")) return [{ Id: ACCOUNT, Name: "Acme", OwnerId: OWNER, CreatedDate: "2026-01-01T00:00:00.000+0000", LastModifiedDate: "2026-02-01T00:00:00.000+0000" }];
  if (soql.includes("FROM User WHERE Id IN")) return [{ Id: OWNER, Name: "Pat Owner" }];
  if (soql.includes("FROM Contact WHERE AccountId")) return [{ Id: CONTACT, Name: "Casey Contact" }];
  return [];
};

describe("recordNodeKey / parseRecordNodeKey", () => {
  it("round-trips and rejects other key shapes", () => {
    expect(parseRecordNodeKey(recordNodeKey("Account", ACCOUNT))).toEqual({ objectApiName: "Account", recordId: ACCOUNT });
    expect(parseRecordNodeKey("SalesforceMetadata.CustomObject::Account")).toBeNull();
    expect(parseRecordNodeKey("Record::Account")).toBeNull();
  });
});

describe("likeLiteral", () => {
  it("escapes quotes, backslashes and wildcards", () => {
    expect(likeLiteral("o'brien")).toBe("'%o\\'brien%'");
    expect(likeLiteral("100%_x\\")).toBe("'%100\\%\\_x\\\\%'");
  });
});

describe("RecordService.search / browse", () => {
  it("returns nothing for a term shorter than two characters, without querying", async () => {
    const api = fakeApi(standard);
    expect(await new RecordService(api).search("Account", "a")).toEqual([]);
    expect(api.queries).toEqual([]);
  });

  it("searches the name field with an escaped LIKE and a cap", async () => {
    const api = fakeApi(() => [{ Id: ACCOUNT, Name: "Acme" }, { Id: "001000000000002AAA", Name: null }]);
    const rows = await new RecordService(api).search("Account", "ac'me");
    expect(rows).toEqual([
      { recordId: ACCOUNT, label: "Acme", objectApiName: "Account" },
      { recordId: "001000000000002AAA", label: "(no name)", objectApiName: "Account" },
    ]);
    expect(api.queries[0]).toBe("SELECT Id, Name FROM Account WHERE Name LIKE '%ac\\'me%' ORDER BY Name ASC LIMIT 20");
  });

  it("browses without a filter", async () => {
    const api = fakeApi(() => []);
    await new RecordService(api).browse("Account");
    expect(api.queries[0]).toBe("SELECT Id, Name FROM Account ORDER BY Name ASC LIMIT 20");
  });

  it("rejects a malformed, unknown or unqueryable object before any SOQL", async () => {
    const api = fakeApi(() => []);
    const svc = new RecordService(api);
    await expect(svc.browse("Account; DROP")).rejects.toBeInstanceOf(RecordInputError);
    await expect(svc.browse("Nope")).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(svc.browse("Hidden")).rejects.toBeInstanceOf(RecordInputError);
    expect(api.queries).toEqual([]);
  });
});

describe("RecordService.fragment", () => {
  it("builds the centre, its parent lookups and its children", async () => {
    const f = await new RecordService(fakeApi(standard)).fragment("Account", ACCOUNT);
    expect(f.centerNodeKey).toBe(recordNodeKey("Account", ACCOUNT));
    expect(f.nodes.map((n) => n.label).sort()).toEqual(["Acme", "Casey Contact", "Pat Owner"]);
    expect(f.edges.map((e) => [e.typeKey, e.viaField, e.target])).toEqual(
      expect.arrayContaining([
        ["SalesforceRecord.LOOKUP_TO", "OwnerId", recordNodeKey("User", OWNER)],
        ["SalesforceRecord.CHILD_OF", "AccountId", recordNodeKey("Contact", CONTACT)],
      ]),
    );
    expect(f.hasMore).toBe(false);
    expect(f.overview).toEqual({ ownerName: "Pat Owner", createdDate: "2026-01-01T00:00:00.000+0000", lastModifiedDate: "2026-02-01T00:00:00.000+0000" });
  });

  it("skips unqueryable and unnamed child relationships when probing", async () => {
    const api = fakeApi(standard);
    await new RecordService(api).fragment("Account", ACCOUNT);
    const probe = api.queries.find((q) => q.includes("(SELECT Id FROM"))!;
    expect(probe).toContain("(SELECT Id FROM Contacts LIMIT 1)");
    expect(probe).not.toContain("Hiddens");
  });

  it("flags hasMore and caps children when a relationship has more than the limit", async () => {
    const many = Array.from({ length: MAX_CHILDREN_PER_RELATIONSHIP + 1 }, (_, i) => ({ Id: `003${String(i).padStart(12, "0")}AAA`, Name: `C${i}` }));
    const f = await new RecordService(fakeApi((q) => (q.includes("FROM Contact WHERE AccountId") ? many : standard(q)))).fragment("Account", ACCOUNT);
    expect(f.hasMore).toBe(true);
    expect(f.edges.filter((e) => e.typeKey === "SalesforceRecord.CHILD_OF")).toHaveLength(MAX_CHILDREN_PER_RELATIONSHIP);
  });

  it("falls back to probing relationships one by one when the batched probe fails", async () => {
    const api = fakeApi((q) => (q.includes("(SELECT Id FROM") ? new Error("bad subquery") : q.includes("LIMIT 1") && q.includes("FROM Contact WHERE AccountId") ? [{ Id: CONTACT }] : standard(q)));
    const f = await new RecordService(api).fragment("Account", ACCOUNT);
    expect(f.edges.some((e) => e.typeKey === "SalesforceRecord.CHILD_OF")).toBe(true);
  });

  it("isolates one unqueryable relationship among many without probing every relationship serially", async () => {
    const filler = Array.from({ length: 38 }, (_, i) => ({ childSObject: `Filler${i}`, field: "AccountId", relationshipName: `Fillers${i}` }));
    const bad = { childSObject: "Bad", field: "AccountId", relationshipName: "Bads" };
    const wide: RecordDescribe = { ...describes.Account, childRelationships: [...filler.slice(0, 10), bad, describes.Account.childRelationships[0], ...filler.slice(10)] };
    const wideGlobals: RecordGlobal[] = [...globals, { name: "Bad", keyPrefix: "a01", queryable: true }, ...filler.map((r, i) => ({ name: r.childSObject, keyPrefix: `b${String(i).padStart(2, "0")}`, queryable: true }))];
    const base = fakeApi((q) => (q.includes("(SELECT Id FROM") && q.includes("Bads") ? new Error("not supported") : q.includes("FROM Bad WHERE") ? new Error("not supported") : standard(q)));
    const api: RecordApi & { queries: string[] } = { ...base, describeGlobal: async () => wideGlobals, describe: async (n) => (n === "Account" ? wide : base.describe(n)) };
    const f = await new RecordService(api).fragment("Account", ACCOUNT);
    expect(f.nodes.map((n) => n.label)).toContain("Casey Contact");
    // 40 relationships = 2 batches; isolating one bad one is a handful of queries, not 20 serial ones.
    expect(api.queries.filter((q) => q.includes("(SELECT Id FROM") || q.includes("FROM Bad WHERE")).length).toBeLessThan(20);
  });

  it("keeps the rest of the picture when a parent object cannot be read", async () => {
    const f = await new RecordService(fakeApi((q) => (q.includes("FROM User WHERE Id IN") ? new Error("no access") : standard(q)))).fragment("Account", ACCOUNT);
    expect(f.nodes.map((n) => n.label)).toContain("Acme");
    expect(f.overview?.ownerName).toBeNull();
  });

  it("returns an empty fragment for a record the user cannot see", async () => {
    const f = await new RecordService(fakeApi(() => [])).fragment("Account", ACCOUNT);
    expect(f).toEqual({ centerNodeKey: null, nodes: [], edges: [], hasMore: false, overview: null });
  });

  it("rejects an invalid Id and an Id from another object", async () => {
    const svc = new RecordService(fakeApi(standard));
    await expect(svc.fragment("Account", "x'; --")).rejects.toBeInstanceOf(RecordInputError);
    await expect(svc.fragment("Account", OWNER)).rejects.toBeInstanceOf(RecordInputError);
  });
});
