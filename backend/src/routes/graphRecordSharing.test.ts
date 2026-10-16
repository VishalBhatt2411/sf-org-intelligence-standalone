import "express-async-errors";
import express, { type ErrorRequestHandler } from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GraphSource } from "../graph/graphSource";
import { InMemoryGraphRepository } from "../graph/inMemoryGraphRepository";
import { createGraphRouter } from "./graph";

// The Record mode Sharing route, kept apart from graph.test.ts so its fake source can carry a share table.
const C = "conn-1";
const INVOICE = "a01000000000001AAA";
const USER = "005000000000001AAA";

let server: Server;
let base: string;
let queries: string[] = [];
let sharingCalls: string[] = [];
let authedConnection: string | undefined = C;

const field = (name: string) => ({ name, type: "string", nameField: name === "Name", referenceTo: [] });
const source: Partial<GraphSource> = {
  objectSharing: async (name: string) => {
    sharingCalls.push(name);
    return { supported: true, internalSharingModel: "Private", externalSharingModel: null, unavailableReason: null };
  },
  records: () => ({
    describeGlobal: async () => [
      { name: "Invoice__c", keyPrefix: "a01", queryable: true },
      { name: "Invoice__Share", keyPrefix: null, queryable: true },
    ],
    describe: async (name: string) =>
      name === "Invoice__Share"
        ? { name, queryable: true, fields: ["Id", "ParentId", "AccessLevel", "UserOrGroupId", "RowCause"].map(field), childRelationships: [] }
        : { name, queryable: true, custom: true, fields: [field("Name")], childRelationships: [] },
    query: async (soql: string) => {
      queries.push(soql);
      if (soql.includes("FROM Invoice__Share")) return [{ UserOrGroupId: USER, AccessLevel: "All", RowCause: "Owner" }];
      if (soql.includes("FROM User")) return [{ Id: USER, Name: "Pat Owner" }];
      return [];
    },
  }),
} as Partial<GraphSource>;

beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { auth?: { organizationId: string; connectionId: string } }).auth = authedConnection ? { organizationId: "org", connectionId: authedConnection } : undefined;
    next();
  });
  app.use("/connections/:connectionId/graph", createGraphRouter({ reader: new InMemoryGraphRepository(), sourceFor: async () => source as GraphSource }));
  const failures: ErrorRequestHandler = (_err, _req, res, _next) => {
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(failures);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/connections/${C}/graph`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  queries = [];
  sharingCalls = [];
  authedConnection = C;
});

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

describe("GET /objects/:apiName/records/:recordId/sharing", () => {
  it("returns the record's share rows, approval lock and org-wide default", async () => {
    const res = await get(`/objects/Invoice__c/records/${INVOICE}/sharing`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      supportsSharing: true,
      coverageNote: null,
      shareRows: [{ userOrGroupId: USER, userOrGroupLabel: "Pat Owner", accessLevel: "All", rowCause: "Owner" }],
      truncated: false,
      isLockedByApproval: false,
      pendingApprovalDetail: null,
      orgWideDefault: { supported: true, internalSharingModel: "Private", externalSharingModel: null, unavailableReason: null },
    });
    expect(sharingCalls).toEqual(["Invoice__c"]);
  });

  it("validates the object and record Id before any SOQL", async () => {
    expect((await get(`/objects/Bad%20Name/records/${INVOICE}/sharing`)).status).toBe(400);
    expect((await get(`/objects/Unknown__c/records/${INVOICE}/sharing`)).status).toBe(404);
    expect((await get("/objects/Invoice__c/records/bad-id/sharing")).status).toBe(400);
    expect((await get(`/objects/Invoice__c/records/${USER}/sharing`)).status).toBe(400);
    expect(queries).toEqual([]);
  });

  it("answers another connection as not found", async () => {
    authedConnection = "other";
    expect((await get(`/objects/Invoice__c/records/${INVOICE}/sharing`)).status).toBe(404);
    expect(queries).toEqual([]);
  });
});
