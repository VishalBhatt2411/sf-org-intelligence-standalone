import { describe, expect, it } from "vitest";
import { FakeHealthSource } from "../fakeHealthSource";
import { CONNECTION, NOW, withConfig } from "../healthTestKit";
import { computeStorage } from "./storage";

const run = (data: ConstructorParameters<typeof FakeHealthSource>[0]) => computeStorage({ source: new FakeHealthSource(data), connectionId: CONNECTION, config: withConfig({}), now: NOW });

describe("computeStorage", () => {
  it("reports used storage as facts, unscored", async () => {
    const r = await run({ limits: { DataStorageMB: { max: 1000, remaining: 750 }, FileStorageMB: { max: 20480, remaining: 1024 } } });
    expect(r).toMatchObject({ section: "storage", scored: false, score: null, severity: null, basis: "live" });
    expect(r.kpis.map((k) => [k.key, k.value])).toEqual([["DataStorageMB", "25%"], ["FileStorageMB", "95%"]]);
    expect(r.facts[0]).toMatchObject({ value: "250 MB of 1000 MB (25%)", detail: "Plenty of room" });
    expect(r.facts[1]).toMatchObject({ value: "19 GB of 20 GB (95%)", detail: "Nearly full" });
    expect(r.coverage.complete).toBe(true);
  });

  it("lists a limit the org did not return rather than showing zero", async () => {
    const r = await run({ limits: { DataStorageMB: { max: 100, remaining: 10 } } });
    expect(r.unavailable).toEqual(["File storage was not in the limits response"]);
    expect(r.coverage.complete).toBe(false);
    expect(r.facts[0].detail).toBe("Getting full");
  });

  it("does not throw when the limits read fails", async () => {
    const r = await run({ failing: ["limits"] });
    expect(r.kpis).toEqual([]);
    expect(r.unavailable).toEqual(["Storage limits could not be read"]);
    expect(r.coverage.complete).toBe(false);
  });

  it("treats a zero maximum as 0% rather than dividing by zero", async () => {
    const r = await run({ limits: { DataStorageMB: { max: 0, remaining: 0 }, FileStorageMB: { max: 0, remaining: 0 } } });
    expect(r.kpis.map((k) => k.value)).toEqual(["0%", "0%"]);
  });
});
