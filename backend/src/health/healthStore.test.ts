import { describe, expect, it } from "vitest";
import { InMemoryRunRepository, InMemorySnapshotRepository, SNAPSHOTS_KEPT } from "./healthStore";
import { emptySection } from "./types";

const at = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * 60_000);
const result = (score: number, section: "code" | "data" = "code") => emptySection(section, section, { score, severity: score >= 70 ? "good" : "warning", scored: true });

describe("InMemorySnapshotRepository", () => {
  it("returns the newest snapshot and the trend oldest first", async () => {
    const repo = new InMemorySnapshotRepository();
    await repo.save("c", result(50), at(1));
    await repo.save("c", result(80), at(2));
    expect((await repo.latest("c", "code"))?.score).toBe(80);
    expect((await repo.trend("c", "code", 10)).map((p) => p.score)).toEqual([50, 80]);
    expect((await repo.trend("c", "code", 1)).map((p) => p.score)).toEqual([80]);
  });

  it("keeps connections and sections apart", async () => {
    const repo = new InMemorySnapshotRepository();
    await repo.save("c1", result(10), at(1));
    expect(await repo.latest("c2", "code")).toBeNull();
    expect(await repo.latest("c1", "data")).toBeNull();
  });

  it("prunes to the newest snapshots of a section only", async () => {
    const repo = new InMemorySnapshotRepository();
    for (let i = 0; i < SNAPSHOTS_KEPT + 5; i++) await repo.save("c", result(i % 100), at(i));
    await repo.save("c", result(1, "data"), at(0));
    expect(repo.rows.filter((r) => r.section === "code")).toHaveLength(SNAPSHOTS_KEPT);
    expect(repo.rows.filter((r) => r.section === "data")).toHaveLength(1);
    const trend = await repo.trend("c", "code", 1000);
    expect(trend).toHaveLength(SNAPSHOTS_KEPT);
    expect(trend[0].at).toBe(at(5).toISOString());
  });
});

describe("InMemoryRunRepository", () => {
  it("tracks a run from start to finish", async () => {
    const repo = new InMemoryRunRepository();
    const run = await repo.start("c", "data", at(1));
    expect(run.status).toBe("running");
    await repo.finish("c", run.id, "succeeded", null, at(2));
    expect(await repo.latest("c", "data")).toMatchObject({ status: "succeeded", finishedAt: at(2) });
  });

  it("returns the latest run, and not another connection's", async () => {
    const repo = new InMemoryRunRepository();
    await repo.start("c", "data", at(1));
    const second = await repo.start("c", "data", at(2));
    expect((await repo.latest("c", "data"))?.id).toBe(second.id);
    expect(await repo.latest("other", "data")).toBeNull();
    await repo.finish("other", second.id, "failed", "x", at(3));
    expect((await repo.latest("c", "data"))?.status).toBe("running");
  });
});
