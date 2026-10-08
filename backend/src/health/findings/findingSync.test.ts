import { describe, expect, it } from "vitest";
import { candidate } from "./findingTestKit";
import { syncFindings } from "./findingSync";
import { fingerprintOf } from "./findingTypes";
import { InMemoryFindingRepository } from "./inMemoryFindingRepository";

const C = "conn-1";
const T1 = new Date("2026-10-01T00:00:00Z");
const T2 = new Date("2026-10-02T00:00:00Z");
const T3 = new Date("2026-10-03T00:00:00Z");
const opts = (now: Date, autoResolve = true) => ({ runId: "run", now, autoResolve });
const only = (repo: InMemoryFindingRepository) => [...repo.findings.values()][0];

describe("syncFindings", () => {
  it("creates new findings as open with a stable fingerprint", async () => {
    const repo = new InMemoryFindingRepository();
    const out = await syncFindings(repo, C, "code", [candidate()], opts(T1));
    expect(out).toEqual({ created: 1, refreshed: 0, reopened: 0, resolved: 0 });
    expect(only(repo)).toMatchObject({ status: "open", fingerprint: fingerprintOf("code", "CodeHealth.HighDependency", "k1"), firstDetectedAt: T1, connectionId: C });
  });

  it("refreshes detection fields but leaves triage fields alone", async () => {
    const repo = new InMemoryFindingRepository();
    await syncFindings(repo, C, "code", [candidate()], opts(T1));
    const f = only(repo);
    await repo.update(C, f.id, { status: "in_progress", owner: "Sam", notes: "looking" });
    const out = await syncFindings(repo, C, "code", [candidate({ score: 70, measured: "40", severity: "critical" })], opts(T2));
    expect(out.refreshed).toBe(1);
    expect(only(repo)).toMatchObject({ status: "in_progress", owner: "Sam", notes: "looking", score: 70, measured: "40", severity: "critical", lastDetectedAt: T2, firstDetectedAt: T1 });
  });

  it("collapses duplicate fingerprints in one batch to the last", async () => {
    const repo = new InMemoryFindingRepository();
    const out = await syncFindings(repo, C, "code", [candidate({ score: 1 }), candidate({ score: 2 })], opts(T1));
    expect(out.created).toBe(1);
    expect(repo.findings.size).toBe(1);
    expect(only(repo).score).toBe(2);
  });

  it("auto-resolves findings that are no longer detected, with an audit event, and never deletes", async () => {
    const repo = new InMemoryFindingRepository();
    await syncFindings(repo, C, "code", [candidate()], opts(T1));
    const out = await syncFindings(repo, C, "code", [], opts(T2));
    expect(out.resolved).toBe(1);
    expect(only(repo)).toMatchObject({ status: "resolved", resolvedAt: T2 });
    expect(repo.allEvents).toMatchObject([{ field: "status", oldValue: "open", newValue: "resolved", changedBy: "system" }]);
  });

  it("auto-resolves an accepted risk that is gone, but never a false positive", async () => {
    const repo = new InMemoryFindingRepository();
    await syncFindings(repo, C, "code", [candidate({ componentKey: "a" }), candidate({ componentKey: "b" })], opts(T1));
    const [a, b] = [...repo.findings.values()];
    await repo.update(C, a.id, { status: "risk_accepted" });
    await repo.update(C, b.id, { status: "false_positive" });
    await syncFindings(repo, C, "code", [], opts(T2));
    expect(repo.findings.get(a.id)!.status).toBe("resolved");
    expect(repo.findings.get(b.id)!.status).toBe("false_positive");
  });

  it("reopens a resolved finding that is detected again, noting it in the evidence", async () => {
    const repo = new InMemoryFindingRepository();
    await syncFindings(repo, C, "code", [candidate()], opts(T1));
    await syncFindings(repo, C, "code", [], opts(T2));
    const out = await syncFindings(repo, C, "code", [candidate()], opts(T3));
    expect(out.reopened).toBe(1);
    expect(only(repo)).toMatchObject({ status: "open", resolvedAt: null });
    expect(only(repo).evidence).toContain("Reopened: detected again after being resolved on 2026-10-02");
    expect(repo.allEvents.map((e) => `${e.oldValue}>${e.newValue}`)).toEqual(["open>resolved", "resolved>open"]);
  });

  it("does not reopen accepted risks or false positives that are detected again", async () => {
    const repo = new InMemoryFindingRepository();
    await syncFindings(repo, C, "code", [candidate({ componentKey: "a" }), candidate({ componentKey: "b" })], opts(T1));
    const [a, b] = [...repo.findings.values()];
    await repo.update(C, a.id, { status: "risk_accepted" });
    await repo.update(C, b.id, { status: "false_positive" });
    const out = await syncFindings(repo, C, "code", [candidate({ componentKey: "a" }), candidate({ componentKey: "b" })], opts(T2));
    expect(out).toMatchObject({ reopened: 0, refreshed: 2 });
    expect(repo.findings.get(a.id)!.status).toBe("risk_accepted");
    expect(repo.findings.get(b.id)!.status).toBe("false_positive");
  });

  it("leaves absent findings alone when the run was partial", async () => {
    const repo = new InMemoryFindingRepository();
    await syncFindings(repo, C, "code", [candidate()], opts(T1));
    const out = await syncFindings(repo, C, "code", [], opts(T2, false));
    expect(out.resolved).toBe(0);
    expect(only(repo).status).toBe("open");
  });

  it("only touches its own section and connection", async () => {
    const repo = new InMemoryFindingRepository();
    await syncFindings(repo, C, "code", [candidate()], opts(T1));
    await syncFindings(repo, "conn-2", "code", [candidate()], opts(T1));
    await syncFindings(repo, C, "metadata", [], opts(T2));
    await syncFindings(repo, "conn-2", "code", [], opts(T2));
    const byConn = (c: string) => [...repo.findings.values()].find((f) => f.connectionId === c)!;
    expect(byConn(C).status).toBe("open");
    expect(byConn("conn-2").status).toBe("resolved");
  });

  it("refuses a candidate of another section", async () => {
    await expect(syncFindings(new InMemoryFindingRepository(), C, "metadata", [candidate()], opts(T1))).rejects.toThrow(/section/);
  });

  it("handles a bulk batch", async () => {
    const repo = new InMemoryFindingRepository();
    const many = Array.from({ length: 1500 }, (_, i) => candidate({ componentKey: `k${i}` }));
    expect((await syncFindings(repo, C, "code", many, opts(T1))).created).toBe(1500);
    expect((await syncFindings(repo, C, "code", many.slice(0, 500), opts(T2))).resolved).toBe(1000);
  });
});
