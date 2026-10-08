import { describe, expect, it } from "vitest";
import { FakeHealthSource, type FakeData } from "../fakeHealthSource";
import type { ObjectProfile } from "../healthSource";
import { CONNECTION, NOW, withConfig } from "../healthTestKit";
import { computeData } from "./data";

const cfg = withConfig({
  data: {
    objects: ["Account", "Contact"],
    completenessFields: { Account: ["Phone"], Contact: ["Email"] },
    duplicateKeys: { Account: ["Name"], Contact: ["Email"] },
    sampleCeiling: 200,
  },
});

type Rec = Record<string, string | null>;
const profile = (object: string, sample: Rec[], over: Partial<ObjectProfile> = {}): ObjectProfile => ({ object, total: sample.length, stale: 0, sample, missingFields: [], ...over });
const accounts = (n: number, over: (i: number) => Rec = () => ({})): Rec[] => Array.from({ length: n }, (_, i) => ({ Name: `Acme ${i}`, Phone: "555", ...over(i) }));
const contacts = (n: number): Rec[] => Array.from({ length: n }, (_, i) => ({ Email: `c${i}@x.com` }));

async function run(profiles: Record<string, ObjectProfile>, extra: Partial<FakeData> = {}, config = cfg) {
  const source = new FakeHealthSource({ profiles, ...extra });
  return { source, ...(await computeData({ source, connectionId: CONNECTION, config, now: NOW })) };
}

describe("computeData", () => {
  it("scores 100 and proposes nothing for clean data", async () => {
    const { result, candidates } = await run({ Account: profile("Account", accounts(20)), Contact: profile("Contact", contacts(20)) });
    expect(result).toMatchObject({ section: "data", scored: true, score: 100, severity: "good", basis: "live" });
    expect(candidates).toEqual([]);
    expect(result.coverage.complete).toBe(true);
    expect(result.coverage.note).toContain("2 of 2 objects profiled");
    expect(result.coverage.note).toContain("sample of up to 200");
  });

  it("flags stale records using the exact count, not the sample", async () => {
    const { result, candidates } = await run({ Account: profile("Account", accounts(10), { total: 1000, stale: 400 }), Contact: profile("Contact", contacts(5)) });
    const c = candidates.find((x) => x.ruleKey === "DataHealth.StaleRecords")!;
    expect(c).toMatchObject({ section: "data", componentLabel: "Account", measured: "40% stale", expected: "< 15% stale", confidence: "medium" });
    expect(c.evidence).toContain("400 of 1000");
    // 1 of 2 objects breaches the 35% stale rule: 100 - 17.5 = 82.5 -> 83.
    expect(result.score).toBe(83);
  });

  it("flags incomplete records from the sample, treating blank text as missing", async () => {
    const sample = accounts(10, (i): Rec => (i < 3 ? { Phone: i === 0 ? null : "  " } : {}));
    const { candidates } = await run({ Account: profile("Account", sample), Contact: profile("Contact", contacts(5)) });
    const c = candidates.find((x) => x.ruleKey === "DataHealth.Completeness")!;
    expect(c.measured).toBe("30% incomplete (sample of 10)");
    expect(c.confidence).toBe("low");
  });

  it("finds exact duplicates ignoring case and surrounding spaces, and ignores records with no key", async () => {
    const sample: Rec[] = [{ Name: "Acme", Phone: "1" }, { Name: " ACME ", Phone: "1" }, { Name: "acme", Phone: "1" }, { Name: null, Phone: "1" }, { Name: null, Phone: "1" }, ...accounts(5)];
    const { candidates } = await run({ Account: profile("Account", sample), Contact: profile("Contact", contacts(5)) });
    const c = candidates.find((x) => x.ruleKey === "DataHealth.Duplicates")!;
    expect(c.measured).toBe("20% duplicates (sample of 10)");
  });

  it("does not flag a rate just below the threshold", async () => {
    const sample = accounts(100, (i): Rec => (i < 9 ? { Phone: null } : {}));
    const { candidates } = await run({ Account: profile("Account", sample), Contact: profile("Contact", contacts(5)) });
    expect(candidates.filter((c) => c.ruleKey === "DataHealth.Completeness")).toEqual([]);
  });

  it("lists an unreadable object, still scores the rest, and marks coverage partial", async () => {
    const { result } = await run({ Account: profile("Account", accounts(5)) }, { failing: ["objectProfile:Contact"] });
    expect(result.unavailable).toEqual(["Contact could not be read"]);
    expect(result.score).toBe(100);
    expect(result.coverage).toMatchObject({ complete: false });
    expect(result.coverage.note).toContain("1 of 2 objects profiled");
  });

  it("reports no score when no object could be read", async () => {
    const { result, candidates } = await run({}, {});
    expect(result.score).toBeNull();
    expect(result.severity).toBeNull();
    expect(result.unavailable).toHaveLength(2);
    expect(candidates).toEqual([]);
  });

  it("skips a field the org does not have and says so, without scoring that rule", async () => {
    const { result, candidates } = await run({ Account: profile("Account", accounts(5).map(({ Name }) => ({ Name })), { missingFields: ["Phone"] }), Contact: profile("Contact", contacts(5)) });
    expect(candidates).toEqual([]);
    expect(result.unavailable).toContain("Account.Phone is not available on this org and was skipped");
    expect(result.coverage.complete).toBe(false);
  });

  it("leaves empty objects out of the score", async () => {
    const { result } = await run({ Account: profile("Account", []), Contact: profile("Contact", contacts(5)) });
    expect(result.score).toBe(100);
    expect(result.coverage.note).toContain("1 object had no records and was not scored");
  });

  it("uses the configured thresholds and stale window", async () => {
    const strict = withConfig({ data: { ...cfg.data, staleThresholdPercent: 5 } });
    const { candidates, source } = await run({ Account: profile("Account", accounts(5), { total: 100, stale: 8 }), Contact: profile("Contact", contacts(5)) }, {}, strict);
    expect(candidates.map((c) => c.ruleKey)).toEqual(["DataHealth.StaleRecords"]);
    expect(source.calls).toEqual(["objectProfile:Account", "objectProfile:Contact"]);
  });

  it("handles a full-size sample quickly", async () => {
    const sample = accounts(200, (i) => ({ Name: `Name ${i % 150}` }));
    const { result } = await run({ Account: profile("Account", sample, { total: 50_000 }), Contact: profile("Contact", contacts(200)) });
    expect(result.kpis.find((k) => k.key === "Sampled")?.value).toBe("400");
    expect(result.kpis.find((k) => k.key === "Profiled")?.value).toBe("2");
  });
});
