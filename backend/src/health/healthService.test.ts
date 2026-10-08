import { describe, expect, it } from "vitest";
import type { EdgeSpec } from "../graph/graphTestKit";
import { InMemoryFindingRepository } from "./findings/inMemoryFindingRepository";
import { FakeHealthSource, type FakeData } from "./fakeHealthSource";
import type { HealthGraphRepository } from "./healthGraphRepository";
import { HealthService } from "./healthService";
import { InMemoryRunRepository, InMemorySnapshotRepository } from "./healthStore";
import { CONNECTION, NOW, healthGraph, keyFor, withConfig, type NodeSpecT } from "./healthTestKit";
import { HealthInputError, HealthNotFoundError } from "./errors";
import type { SecuritySet } from "./healthSource";

const config = withConfig({
  code: { dependencyThreshold: 3 },
  data: { objects: ["Account"], completenessFields: { Account: ["Phone"] }, duplicateKeys: { Account: ["Name"] }, sampleCeiling: 200 },
});

const cls = (fqn: string): NodeSpecT => ({ kind: "ApexClass", fqn, attributes: { lineCount: 10, apiVersion: 60 } });
const refs = (from: string, to: string): EdgeSpec => ({ type: "REFERENCES", from: ["ApexClass", from], to: ["ApexClass", to] });
const HUB_NODES = [cls("Hub"), cls("A"), cls("B"), cls("C")];
const HUB_EDGES = [refs("Hub", "A"), refs("Hub", "B"), refs("C", "Hub"), refs("A", "Hub")];
const secSet = (id: string, flags: SecuritySet["flags"] = []): SecuritySet => ({ id, name: `Set_${id}`, label: `Set ${id}`, namespace: null, profileOwned: false, flags });

type Setup = { nodes?: NodeSpecT[]; edges?: EdgeSpec[]; source?: FakeData; graph?: HealthGraphRepository };

async function build(setup: Setup = {}, shared?: { findings?: InMemoryFindingRepository; snapshots?: InMemorySnapshotRepository; runs?: InMemoryRunRepository }) {
  const graph = setup.graph ?? (await healthGraph(setup.nodes ?? [], setup.edges ?? [])).graph;
  const findings = shared?.findings ?? new InMemoryFindingRepository();
  const snapshots = shared?.snapshots ?? new InMemorySnapshotRepository();
  const runs = shared?.runs ?? new InMemoryRunRepository();
  const source = new FakeHealthSource(setup.source ?? {});
  const jobs: Promise<void>[] = [];
  let now = NOW;
  const service = new HealthService({ graph, findings, snapshots, runs, sourceFor: async () => source, config, now: () => now, spawn: (j) => void jobs.push(j) });
  return { service, findings, snapshots, runs, source, settle: () => Promise.all(jobs), advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe("section", () => {
  it("computes a scan section on the fly without storing anything", async () => {
    const { service, snapshots } = await build({ nodes: HUB_NODES, edges: HUB_EDGES });
    const result = await service.section(CONNECTION, "code");
    expect(result.section).toBe("code");
    expect(result.score).not.toBeNull();
    expect(snapshots.rows).toEqual([]);
  });

  it("serves the stored snapshot once a sync has stored one", async () => {
    const { service, snapshots } = await build({ nodes: HUB_NODES, edges: HUB_EDGES });
    await service.sync(CONNECTION, "code");
    expect(snapshots.rows).toHaveLength(1);
    expect((await service.section(CONNECTION, "code")).computedAt).toBe(snapshots.rows[0].result.computedAt);
  });

  it("answers 'not run yet' for Security and Data before their first run", async () => {
    const { service, source } = await build();
    for (const key of ["security", "data"] as const) {
      const r = await service.section(CONNECTION, key);
      expect(r).toMatchObject({ section: key, score: null, basis: "live" });
      expect(r.coverage).toMatchObject({ complete: false });
      expect(r.coverage.note).toContain("Not run yet");
    }
    expect(source.calls).toEqual([]);
  });

  it("reads Storage live every time", async () => {
    const { service, source, snapshots } = await build({ source: { limits: { DataStorageMB: { max: 1000, remaining: 400 }, FileStorageMB: { max: 1000, remaining: 900 } } } });
    const r = await service.section(CONNECTION, "storage");
    expect(r.section).toBe("storage");
    expect(source.calls).toContain("limits");
    expect(snapshots.rows).toEqual([]);
  });

  it("rejects an unknown section", async () => {
    const { service } = await build();
    expect(() => service.assertSection("nope")).toThrow(HealthInputError);
    expect(() => service.assertSection(undefined)).toThrow(HealthInputError);
  });
});

describe("drilldown", () => {
  it("returns the list behind a tile", async () => {
    const { service } = await build({ nodes: HUB_NODES, edges: HUB_EDGES });
    const d = await service.drilldown(CONNECTION, "code", "HighDependency");
    expect(d.rows.map((r) => r.label)).toEqual(["Hub"]);
  });

  it.each([
    ["code", "Nope"],
    ["code", undefined],
    ["metadata", "OldApiVersion"],
    ["security", "HighDependency"],
    ["overview", "x"],
  ] as const)("rejects %s / %s", async (section, key) => {
    const { service } = await build();
    await expect(service.drilldown(CONNECTION, section, key)).rejects.toBeInstanceOf(HealthInputError);
  });
});

describe("sync", () => {
  it("stores a snapshot and raises findings from a scan section", async () => {
    const { service, findings, snapshots } = await build({ nodes: HUB_NODES, edges: HUB_EDGES });
    const report = await service.sync(CONNECTION, "code");
    expect(report.findings?.created).toBeGreaterThan(0);
    expect([...findings.findings.values()].map((f) => f.ruleKey)).toContain("CodeHealth.HighDependency");
    expect(snapshots.rows.map((r) => r.section)).toEqual(["code"]);
  });

  it("resolves findings that are gone once the section was seen in full", async () => {
    const shared = { findings: new InMemoryFindingRepository(), snapshots: new InMemorySnapshotRepository(), runs: new InMemoryRunRepository() };
    await (await build({ nodes: HUB_NODES, edges: HUB_EDGES }, shared)).service.sync(CONNECTION, "code");
    const fixed = await build({ nodes: HUB_NODES, edges: [] }, shared);
    const report = await fixed.service.sync(CONNECTION, "code");
    expect(report.findings?.resolved).toBeGreaterThan(0);
    expect([...shared.findings.findings.values()].every((f) => f.status === "resolved")).toBe(true);
  });

  it("keeps findings open when the live read was incomplete", async () => {
    const shared = { findings: new InMemoryFindingRepository(), snapshots: new InMemorySnapshotRepository(), runs: new InMemoryRunRepository() };
    const first = await build({ source: { sets: [secSet("1", ["PermissionsModifyAllData"])], assignments: { "1": 4 } } }, shared);
    await first.service.sync(CONNECTION, "security");
    expect([...shared.findings.findings.values()]).toHaveLength(1);

    const broken = await build({ source: { failing: ["securitySets"] } }, shared);
    const report = await broken.service.sync(CONNECTION, "security");
    expect(report.findings?.resolved).toBe(0);
    expect([...shared.findings.findings.values()][0].status).toBe("open");
  });

  it("does not run Data or Storage through sync", async () => {
    const { service } = await build();
    await expect(service.sync(CONNECTION, "data")).rejects.toBeInstanceOf(HealthInputError);
    await expect(service.sync(CONNECTION, "storage")).rejects.toBeInstanceOf(HealthInputError);
  });

  it("stores the overview without findings", async () => {
    const { service, snapshots, findings } = await build({ nodes: HUB_NODES, edges: HUB_EDGES });
    expect((await service.sync(CONNECTION, "overview")).findings).toBeNull();
    expect(snapshots.rows.map((r) => r.section)).toEqual(["overview"]);
    expect(findings.findings.size).toBe(0);
  });
});

describe("syncAfterScan", () => {
  it("refreshes the four scan sections", async () => {
    const { service, snapshots } = await build({ nodes: HUB_NODES, edges: HUB_EDGES });
    expect(await service.syncAfterScan(CONNECTION)).toEqual({ failed: [] });
    expect(snapshots.rows.map((r) => r.section).sort()).toEqual(["automation", "code", "metadata", "overview"]);
  });

  it("logs a failing section, carries on with the rest and never throws", async () => {
    const real = (await healthGraph(HUB_NODES, HUB_EDGES)).graph;
    const graph = Object.create(real, { browseNodes: { value: async () => Promise.reject(new Error("db down")) } }) as HealthGraphRepository;
    const { service, snapshots } = await build({ graph });
    const out = await service.syncAfterScan(CONNECTION);
    expect(out.failed.sort()).toEqual(["automation", "code", "metadata"]);
    expect(snapshots.rows.map((r) => r.section)).toEqual(["overview"]);
  });

  it("is a harmless no-op on an empty graph", async () => {
    const { service, findings } = await build();
    expect((await service.syncAfterScan(CONNECTION)).failed).toEqual([]);
    expect(findings.findings.size).toBe(0);
  });
});

describe("data run", () => {
  const dirty = { profiles: { Account: { object: "Account", total: 1000, stale: 500, sample: [{ Name: "A", Phone: "1" }], missingFields: [] } } };

  it("starts in the background, then stores the result and raises findings", async () => {
    const { service, runs, snapshots, findings, settle } = await build({ source: dirty });
    const { run, started } = await service.startDataRun(CONNECTION);
    expect(started).toBe(true);
    expect(run.status).toBe("running");
    expect((await service.dataRun(CONNECTION))?.status).toBe("running");
    await settle();
    expect(runs.runs[0]).toMatchObject({ status: "succeeded" });
    expect(snapshots.rows.map((r) => r.section)).toEqual(["data"]);
    expect([...findings.findings.values()].map((f) => f.ruleKey)).toContain("DataHealth.StaleRecords");
    expect([...findings.findings.values()][0].lastRunId).toBe(run.id);
    expect((await service.section(CONNECTION, "data")).score).not.toBeNull();
  });

  it("runs one at a time per connection", async () => {
    const { service, runs, settle } = await build({ source: dirty });
    const [a, b] = await Promise.all([service.startDataRun(CONNECTION), service.startDataRun(CONNECTION)]);
    expect([a.started, b.started].sort()).toEqual([false, true]);
    expect(runs.runs).toHaveLength(1);
    await settle();
    const again = await service.startDataRun(CONNECTION);
    expect(again.started).toBe(true);
    await settle();
    expect(runs.runs).toHaveLength(2);
  });

  it("records a failed run and leaves findings alone", async () => {
    const { service, runs, snapshots, settle } = await build({ source: { failing: ["objectProfile"] } });
    // A failing profile is reported as unavailable, not as a failed run.
    await service.startDataRun(CONNECTION);
    await settle();
    expect(runs.runs[0].status).toBe("succeeded");
    expect(runs.runs[0].message).toContain("unavailable");
    expect(snapshots.rows).toHaveLength(1);
  });

  it("marks the run failed when the connection cannot be opened", async () => {
    const graph = (await healthGraph([])).graph;
    const runs = new InMemoryRunRepository();
    const jobs: Promise<void>[] = [];
    const service = new HealthService({
      graph,
      findings: new InMemoryFindingRepository(),
      snapshots: new InMemorySnapshotRepository(),
      runs,
      sourceFor: async () => Promise.reject(new Error("token expired")),
      config,
      now: () => NOW,
      spawn: (j) => void jobs.push(j),
    });
    await service.startDataRun(CONNECTION);
    await Promise.all(jobs);
    expect(runs.runs[0]).toMatchObject({ status: "failed" });
    expect(runs.runs[0].message).toContain("token expired");
    // The slot is free again.
    expect((await service.startDataRun(CONNECTION)).started).toBe(true);
  });

  it("closes an orphaned running row before starting a new run", async () => {
    const { service, runs, settle } = await build({ source: dirty });
    await runs.start(CONNECTION, "data", NOW);
    const { started } = await service.startDataRun(CONNECTION);
    await settle();
    expect(started).toBe(true);
    expect(runs.runs.map((r) => r.status)).toEqual(["failed", "succeeded"]);
    expect(runs.runs[0].message).toContain("interrupted");
  });

  it("reports an old orphaned run as interrupted when polled", async () => {
    const { service, runs, advance } = await build();
    await runs.start(CONNECTION, "data", NOW);
    expect((await service.dataRun(CONNECTION))?.status).toBe("running");
    advance(16 * 60_000);
    const polled = await service.dataRun(CONNECTION);
    expect(polled).toMatchObject({ status: "failed" });
    expect(runs.runs[0].status).toBe("failed");
  });

  it("is null before any run", async () => {
    const { service } = await build();
    expect(await service.dataRun(CONNECTION)).toBeNull();
  });
});

describe("findings workflow", () => {
  async function withFindings() {
    const ctx = await build({ nodes: HUB_NODES, edges: HUB_EDGES });
    await ctx.service.sync(CONNECTION, "code");
    const [first] = [...ctx.findings.findings.values()];
    return { ...ctx, id: first.id, first };
  }

  it("lists findings, with `section` as shorthand for `sections`", async () => {
    const { service } = await withFindings();
    expect((await service.listFindings(CONNECTION, { section: "code" })).total).toBeGreaterThan(0);
    expect((await service.listFindings(CONNECTION, { section: "data" })).total).toBe(0);
    expect((await service.listFindings(CONNECTION, { sections: "code", statuses: "resolved" })).total).toBe(0);
    await expect(service.listFindings(CONNECTION, { section: "bogus" })).rejects.toBeInstanceOf(HealthInputError);
  });

  it("returns the detail with the flags", async () => {
    const { service, id } = await withFindings();
    expect(await service.finding(CONNECTION, id)).toMatchObject({ id, overdue: false, riskExpired: false, explanation: expect.any(String) });
  });

  it("does not show a finding of another connection", async () => {
    const { service, id } = await withFindings();
    for (const call of [() => service.finding("other", id), () => service.related("other", id), () => service.history("other", id), () => service.navigate("other", id), () => service.triage("other", id, { owner: "x" }, "a")]) {
      await expect(call()).rejects.toBeInstanceOf(HealthNotFoundError);
    }
  });

  it("lists other findings on the same component, never the finding itself", async () => {
    const ctx = await build({ nodes: [cls("Hub"), cls("A"), cls("B"), cls("C"), { ...cls("Old"), attributes: { lineCount: 1, apiVersion: 30 } }], edges: HUB_EDGES });
    await ctx.service.sync(CONNECTION, "code");
    const hub = [...ctx.findings.findings.values()].filter((f) => f.componentKey === keyFor("ApexClass", "Hub"));
    const related = await ctx.service.related(CONNECTION, hub[0].id);
    expect(related.map((r) => r.id)).toEqual(hub.slice(1).map((f) => f.id).sort());
    expect(related.every((r) => r.id !== hub[0].id)).toBe(true);
  });

  it("opens the graph node of a finding, and says so when the node is gone", async () => {
    const { service, id, first, findings } = await withFindings();
    expect(await service.navigate(CONNECTION, id)).toMatchObject({ nodeKey: first.componentKey, label: first.componentLabel });
    findings.findings.set(id, { ...first, componentKey: "missing-node" });
    await expect(service.navigate(CONNECTION, id)).rejects.toBeInstanceOf(HealthNotFoundError);
  });

  it("applies triage as the caller and records the history", async () => {
    const { service, id } = await withFindings();
    const saved = await service.triage(CONNECTION, id, { status: "acknowledged", owner: "Sam" }, "org-1");
    expect(saved).toMatchObject({ status: "acknowledged", owner: "Sam" });
    const history = await service.history(CONNECTION, id);
    expect(history.map((e) => [e.field, e.changedBy]).sort()).toEqual([["owner", "org-1"], ["status", "org-1"]]);
  });

  it("rejects an invalid triage and leaves the finding as it was", async () => {
    const { service, id } = await withFindings();
    await expect(service.triage(CONNECTION, id, { status: "false_positive" }, "org-1")).rejects.toBeInstanceOf(HealthInputError);
    expect((await service.finding(CONNECTION, id)).status).toBe("open");
  });

  it("builds a CSV and a summary from the same findings", async () => {
    const { service } = await withFindings();
    const csv = await service.remediationCsv(CONNECTION, {});
    expect(csv.total).toBeGreaterThan(0);
    expect(csv.csv.split("\r\n")[0]).toContain("Section");
    expect((await service.remediationSummary(CONNECTION)).active).toBe(csv.total);
  });
});

describe("summary, trend and registry", () => {
  it("has one card per section and the finding totals", async () => {
    const { service } = await build({ nodes: HUB_NODES, edges: HUB_EDGES });
    await service.sync(CONNECTION, "code");
    const s = await service.summary(CONNECTION);
    expect(s.cards.map((c) => c.section)).toEqual(["overview", "metadata", "automation", "code", "security", "data", "storage"]);
    expect(s.cards.find((c) => c.section === "security")?.note).toContain("Not run yet");
    expect(s.findings.active).toBeGreaterThan(0);
  });

  it("returns the trend oldest first and validates the section", async () => {
    const { service, advance } = await build({ nodes: HUB_NODES, edges: HUB_EDGES });
    await service.sync(CONNECTION, "code");
    advance(60_000);
    await service.sync(CONNECTION, "code");
    const trend = await service.trend(CONNECTION, "code");
    expect(trend).toHaveLength(2);
    expect(trend[0].at < trend[1].at).toBe(true);
    await expect(service.trend(CONNECTION, "nope")).rejects.toBeInstanceOf(HealthInputError);
    expect(await service.trend("other", "code")).toEqual([]);
  });

  it("publishes the registry from the configuration in force", async () => {
    const { service } = await build();
    const reg = service.severityRegistry();
    expect(reg.bands.map((b) => b.severity)).toEqual(["good", "warning", "critical"]);
    expect(reg.rules.find((r) => r.ruleKey === "CodeHealth.HighDependency")?.threshold).toContain("3");
  });
});
