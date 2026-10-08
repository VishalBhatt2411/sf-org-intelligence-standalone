import "express-async-errors";
import express, { type ErrorRequestHandler } from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GraphSource } from "../graph/graphSource";
import { keyOfRef, seed, type Ref } from "../graph/graphTestKit";
import { InMemoryGraphRepository } from "../graph/inMemoryGraphRepository";
import { createGraphRouter } from "./graph";

const C = "conn-1";
const obj: Ref = ["CustomObject", "Invoice__c"];
const cls = (n: string): Ref => ["ApexClass", n];
const OBJ_KEY = keyOfRef(obj);

let server: Server;
let base: string;
let describeCalls: string[][] = [];
let authedConnection: string | undefined = C;

// Describes only Invoice__c; anything else comes back not found, like an inaccessible object.
const source: Partial<GraphSource> = {
  describe: async (names: string[]) => {
    describeCalls.push(names);
    const described = names.includes("Invoice__c")
      ? [{ name: "Invoice__c", fields: [{ name: "Amount__c", label: "Amount", type: "currency", referenceTo: [], masterDetail: false, sfId: "00N000000000001" }] }]
      : [];
    return { described, failed: [] };
  },
} as Partial<GraphSource>;

beforeAll(async () => {
  const repo = new InMemoryGraphRepository();
  await seed(repo, C, [obj, cls("Svc"), cls("Ctl")], [
    { type: "REFERENCES", from: cls("Svc"), to: obj },
    { type: "REFERENCES", from: cls("Ctl"), to: cls("Svc") },
  ]);
  await seed(repo, "other-conn", [cls("Secret")], []);

  const app = express();
  // Stands in for requireAuth: the session belongs to one connection.
  app.use((req, _res, next) => {
    (req as unknown as { auth?: { organizationId: string; connectionId: string } }).auth = authedConnection ? { organizationId: "org", connectionId: authedConnection } : undefined;
    next();
  });
  app.use("/connections/:connectionId/graph", createGraphRouter({ reader: repo, sourceFor: async () => source as GraphSource }));
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

async function get(path: string, root = base) {
  const response = await fetch(`${root}${path}`);
  return { status: response.status, body: (await response.json()) as any };
}

describe("graph routes", () => {
  it("searches by prefix", async () => {
    const { status, body } = await get("/search?q=inv");
    expect(status).toBe(200);
    expect(body.nodes.map((n: { label: string }) => n.label)).toEqual(["Invoice__c"]);
  });

  it("rejects bad search input with 400 and a readable message", async () => {
    expect((await get("/search?q=a")).status).toBe(400);
    expect((await get("/search")).status).toBe(400);
    expect((await get("/search?q=ab&limit=-1")).status).toBe(400);
    expect((await get("/search?q=ab&limit=abc")).status).toBe(400);
    expect((await get("/search?q=ab&q=cd")).status).toBe(400);
    expect((await get("/search?q[x]=cd")).status).toBe(400);
    expect((await get("/search?q=a")).body.error).toMatch(/at least 2/);
  });

  it("browses one type and requires the type", async () => {
    const ok = await get(`/browse?typeKey=${encodeURIComponent("SalesforceMetadata.ApexClass")}`);
    expect(ok.status).toBe(200);
    expect(ok.body.nodes).toHaveLength(2);
    expect((await get("/browse")).status).toBe(400);
  });

  it("expands a node, honouring hops", async () => {
    const one = await get(`/nodes/${OBJ_KEY}/expand`);
    expect(one.status).toBe(200);
    expect(one.body.nodes).toHaveLength(2);
    const two = await get(`/nodes/${OBJ_KEY}/expand?hops=2`);
    expect(two.body.nodes).toHaveLength(3);
    expect(two.body.nextCursor).toBeNull();
  });

  it("validates expand parameters", async () => {
    expect((await get("/nodes/not-a-key/expand")).status).toBe(400);
    expect((await get(`/nodes/${OBJ_KEY}/expand?cursor=nope`)).status).toBe(400);
    expect((await get(`/nodes/${OBJ_KEY}/expand?known=xyz`)).status).toBe(400);
    expect((await get(`/nodes/${OBJ_KEY}/expand?hops=1.5`)).status).toBe(400);
  });

  it("accepts known checksums and returns identity only for matches", async () => {
    const first = await get(`/nodes/${OBJ_KEY}/expand`);
    const svc = first.body.nodes.find((n: { label?: string }) => n.label === "Svc");
    const again = await get(`/nodes/${OBJ_KEY}/expand?known=${svc.checksum}`);
    expect(again.body.nodes.find((n: { nodeKey: string }) => n.nodeKey === svc.nodeKey)).toEqual({ nodeKey: svc.nodeKey, checksum: svc.checksum, ring: 1, unchanged: true });
  });

  it("answers 404 for a valid but unknown node", async () => {
    const missing = "0".repeat(64);
    expect((await get(`/nodes/${missing}/expand`)).status).toBe(404);
    expect((await get(`/nodes/${missing}/impact`)).status).toBe(404);
    expect((await get(`/nodes/${missing}`)).status).toBe(404);
  });

  it("runs impact analysis in both directions and rejects an unknown direction", async () => {
    const down = await get(`/nodes/${OBJ_KEY}/impact?depth=2`);
    expect(down.status).toBe(200);
    expect(down.body.nodes.map((n: { label: string }) => n.label)).toEqual(["Svc", "Ctl"]);
    const up = await get(`/nodes/${keyOfRef(cls("Ctl"))}/impact?direction=upstream`);
    expect(up.body.nodes.map((n: { label: string }) => n.label)).toEqual(["Svc", "Invoice__c"]);
    expect((await get(`/nodes/${OBJ_KEY}/impact?direction=sideways`)).status).toBe(400);
  });

  it("returns node detail", async () => {
    const { status, body } = await get(`/nodes/${OBJ_KEY}`);
    expect(status).toBe(200);
    expect(body.node.label).toBe("Invoice__c");
    expect(body.edgeTotal).toBe(1);
  });

  it("returns a summary", async () => {
    const { status, body } = await get("/summary");
    expect(status).toBe(200);
    expect(body).toMatchObject({ totalNodes: 3, totalEdges: 2, coverage: "none" });
  });

  it("describes an object's fields, exposing only the listed properties", async () => {
    describeCalls = [];
    const { status, body } = await get("/objects/Invoice__c/fields");
    expect(status).toBe(200);
    expect(body).toEqual({ apiName: "Invoice__c", fields: [{ name: "Amount__c", label: "Amount", type: "currency", referenceTo: [], masterDetail: false }] });
    expect(describeCalls).toEqual([["Invoice__c"]]);
  });

  it("answers 404 for an object that cannot be described and 400 for a malformed name, without calling Salesforce", async () => {
    expect((await get("/objects/Missing__c/fields")).status).toBe(404);
    describeCalls = [];
    expect((await get("/objects/Bad%20Name/fields")).status).toBe(400);
    expect((await get("/objects/1abc/fields")).status).toBe(400);
    expect((await get("/objects/a'b/fields")).status).toBe(400);
    expect(describeCalls).toEqual([]);
  });

  it("treats another connection's id as not found on every route", async () => {
    const foreign = `http://127.0.0.1:${(server.address() as AddressInfo).port}/connections/other-conn/graph`;
    for (const path of ["/search?q=sec", "/summary", `/nodes/${OBJ_KEY}`, `/nodes/${OBJ_KEY}/expand`, `/nodes/${OBJ_KEY}/impact`, "/objects/Invoice__c/fields", "/browse?typeKey=x"]) {
      const { status, body } = await get(path, foreign);
      expect([path, status]).toEqual([path, 404]);
      expect(body).toEqual({ error: "Not found" });
    }
  });

  it("answers 404 when there is no session at all", async () => {
    authedConnection = undefined;
    try {
      expect((await get("/summary")).status).toBe(404);
    } finally {
      authedConnection = C;
    }
  });
});
