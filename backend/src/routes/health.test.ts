import "express-async-errors";
import express, { type ErrorRequestHandler } from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemoryFindingRepository } from "../health/findings/inMemoryFindingRepository";
import { FakeHealthSource } from "../health/fakeHealthSource";
import { HealthService } from "../health/healthService";
import { InMemoryRunRepository, InMemorySnapshotRepository } from "../health/healthStore";
import { CONNECTION, healthGraph, withConfig } from "../health/healthTestKit";
import { createHealthRouter } from "./health";

const config = withConfig({ code: { dependencyThreshold: 3 }, data: { objects: ["Account"], completenessFields: { Account: ["Phone"] }, duplicateKeys: { Account: ["Name"] }, sampleCeiling: 200 } });
const cls = (fqn: string) => ({ kind: "ApexClass" as const, fqn, attributes: { lineCount: 10, apiVersion: 60 } });
const refs = (from: string, to: string) => ({ type: "REFERENCES" as const, from: ["ApexClass", from] as [string, string], to: ["ApexClass", to] as [string, string] });

let server: Server;
let base: string;
let authedConnection: string | undefined = CONNECTION;
const jobs: Promise<void>[] = [];

beforeAll(async () => {
  const { graph } = await healthGraph([cls("Hub"), cls("A"), cls("B"), cls("C")], [refs("Hub", "A"), refs("Hub", "B"), refs("C", "Hub"), refs("A", "Hub")]);
  const source = new FakeHealthSource({ profiles: { Account: { object: "Account", total: 1000, stale: 500, sample: [], missingFields: [] } } });
  const service = new HealthService({
    graph,
    findings: new InMemoryFindingRepository(),
    snapshots: new InMemorySnapshotRepository(),
    runs: new InMemoryRunRepository(),
    sourceFor: async () => source,
    config,
    spawn: (job) => void jobs.push(job),
  });

  const app = express();
  app.use(express.json());
  // Stands in for requireAuth: the session belongs to one connection.
  app.use((req, _res, next) => {
    (req as unknown as { auth?: { organizationId: string; connectionId: string } }).auth = authedConnection ? { organizationId: "org-1", connectionId: authedConnection } : undefined;
    next();
  });
  app.use("/connections/:connectionId/health", createHealthRouter({ service }));
  const failures: ErrorRequestHandler = (_err, _req, res, _next) => {
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(failures);

  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/connections/${CONNECTION}/health`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function call(method: string, path: string, body?: unknown, root = base) {
  const response = await fetch(`${root}${path}`, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = response.headers.get("content-type") ?? "";
  return { status: response.status, headers: response.headers, body: type.includes("json") ? ((await response.json()) as any) : await response.text() };
}
const get = (path: string, root = base) => call("GET", path, undefined, root);

describe("health routes", () => {
  it("serves the sections", async () => {
    const code = await get("/code");
    expect(code.status).toBe(200);
    expect(code.body.section).toBe("code");
    expect((await get("/overview")).status).toBe(200);
    expect((await get("/storage")).status).toBe(200);
    expect((await get("/security")).body.score).toBeNull();
  });

  it("rejects an unknown section with 400", async () => {
    expect((await get("/nope")).status).toBe(400);
    expect((await call("POST", "/sync/nope")).status).toBe(400);
  });

  it("serves the summary, registry and trend", async () => {
    const summary = await get("/summary");
    expect(summary.status).toBe(200);
    expect(summary.body.cards).toHaveLength(7);
    expect((await get("/severity-registry")).body.bands).toHaveLength(3);
    expect((await get("/trend?section=code")).body.points).toEqual([]);
    expect((await get("/trend")).status).toBe(400);
    expect((await get("/trend?section=code&section=data")).status).toBe(400);
  });

  it("validates the drill-down key", async () => {
    const ok = await get("/code/drilldown?metricKey=HighDependency");
    expect(ok.status).toBe(200);
    expect(ok.body.rows.map((r: { label: string }) => r.label)).toEqual(["Hub"]);
    expect((await get("/code/drilldown?metricKey=Nope")).status).toBe(400);
    expect((await get("/code/drilldown")).status).toBe(400);
    expect((await get("/security/drilldown?metricKey=x")).status).toBe(400);
  });

  it("syncs a section, then lists, opens and triages its findings", async () => {
    const synced = await call("POST", "/sync/code");
    expect(synced.status).toBe(200);
    expect(synced.body.findings.created).toBeGreaterThan(0);

    const list = await get("/findings?section=code");
    expect(list.status).toBe(200);
    const id = list.body.rows[0].id as string;

    expect((await get(`/findings/${id}`)).body).toMatchObject({ id, status: "open" });
    expect((await get(`/findings/${id}/related`)).body.findings).toBeInstanceOf(Array);
    expect((await get(`/findings/${id}/navigate`)).body.nodeKey).toBeTruthy();

    const patched = await call("PATCH", `/findings/${id}`, { status: "acknowledged", owner: "Sam" });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ status: "acknowledged", owner: "Sam" });
    const history = await get(`/findings/${id}/history`);
    expect(history.body.events.every((e: { changedBy: string }) => e.changedBy === "org-1")).toBe(true);
  });

  it("rejects bad triage and unknown findings", async () => {
    const id = (await get("/findings?section=code")).body.rows[0].id as string;
    expect((await call("PATCH", `/findings/${id}`, { status: "false_positive" })).status).toBe(400);
    expect((await call("PATCH", `/findings/${id}`, { unknown: 1 })).status).toBe(400);
    expect((await get("/findings/does-not-exist")).status).toBe(404);
    expect((await get("/findings/bad%20id")).status).toBe(400);
    expect((await call("PATCH", "/findings/does-not-exist", { owner: "x" })).status).toBe(404);
    expect((await get("/findings?section=bogus")).status).toBe(400);
  });

  it("serves the remediation queue, summary and CSV export", async () => {
    expect((await get("/remediation?sort=severity")).status).toBe(200);
    expect((await get("/remediation/summary")).body.active).toBeGreaterThan(0);
    const csv = await get("/remediation/export");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toContain("attachment");
    expect(csv.headers.get("x-truncated")).toBe("false");
    expect(csv.body.split("\r\n")[0]).toContain("Section");
    expect((await get("/remediation?sort=bogus")).status).toBe(400);
  });

  it("runs Data Health in the background", async () => {
    expect((await get("/data/run")).body.run).toBeNull();
    const started = await call("POST", "/data/run");
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({ started: true, run: { status: "running" } });
    await Promise.all(jobs);
    expect((await get("/data/run")).body.run.status).toBe("succeeded");
    expect((await get("/data")).body.score).not.toBeNull();
    expect((await call("POST", "/sync/data")).status).toBe(400);
  });

  it("does not answer for another connection, or without a session", async () => {
    const other = base.replace(CONNECTION, "other-conn");
    for (const [method, path] of [["GET", "/summary"], ["GET", "/code"], ["GET", "/findings"], ["POST", "/data/run"], ["POST", "/sync/code"]] as const) {
      expect((await call(method, path, undefined, other)).status).toBe(404);
    }
    authedConnection = undefined;
    try {
      expect((await get("/summary")).status).toBe(404);
    } finally {
      authedConnection = CONNECTION;
    }
  });

});
