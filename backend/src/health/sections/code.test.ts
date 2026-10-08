import { describe, expect, it } from "vitest";
import type { EdgeSpec } from "../../graph/graphTestKit";
import { CONNECTION, NOW, healthGraph, withConfig, type NodeSpecT } from "../healthTestKit";
import { codeDrilldown, computeCode } from "./code";

const cfg = withConfig({ code: { dependencyThreshold: 3 } });
const cls = (fqn: string, apiVersion: number | null = 60): NodeSpecT => ({ kind: "ApexClass", fqn, attributes: { lineCount: 10, apiVersion } });
const refs = (from: string, to: string): EdgeSpec => ({ type: "REFERENCES", from: ["ApexClass", from], to: ["ApexClass", to] });

async function run(nodes: NodeSpecT[], edges: EdgeSpec[] = [], config = cfg) {
  const { graph } = await healthGraph(nodes, edges);
  const ctx = { graph, connectionId: CONNECTION, config, now: NOW };
  return { ctx, ...(await computeCode(ctx)) };
}

describe("computeCode", () => {
  it("returns 'no data' for an empty graph", async () => {
    const { result } = await run([]);
    expect(result.score).toBeNull();
    expect(result.coverage.complete).toBe(false);
  });

  it("scores 100 when nothing breaches", async () => {
    const { result, candidates } = await run([cls("A"), cls("B")], [refs("A", "B")]);
    expect(result.score).toBe(100);
    expect(result.severity).toBe("good");
    expect(candidates).toEqual([]);
  });

  it("flags a class on a clearly old API version, and a class only slightly behind is fine", async () => {
    const { result, candidates } = await run([cls("Old", 45), cls("Slightly", 54), cls("Fresh", 62)]);
    expect(candidates.map((c) => c.componentLabel)).toEqual(["Old"]);
    expect(candidates[0]).toMatchObject({ ruleKey: "CodeHealth.OldApiVersion", measured: "API version 45", expected: "API version 55 or later", componentType: "Apex Class" });
    // 1 of 3 classes breaches the 45%-weight rule: 100 - 15 = 85.
    expect(result.score).toBe(85);
  });

  it("leaves classes with no recorded API version out of that rule and says so", async () => {
    const { result, candidates } = await run([cls("Unknown", null), cls("Fresh")]);
    expect(candidates).toEqual([]);
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.note).toContain("1 class had no API version recorded");
    expect(result.breakdown.rows).toEqual([]);
  });

  it("flags high fan-in/out and cycles", async () => {
    const { result, candidates } = await run(
      [cls("Hub"), cls("A"), cls("B"), cls("C")],
      [refs("Hub", "A"), refs("Hub", "B"), refs("C", "Hub"), refs("A", "Hub")],
    );
    expect(candidates.filter((c) => c.ruleKey === "CodeHealth.HighDependency").map((c) => c.componentLabel)).toEqual(["Hub"]);
    expect(result.kpis.find((k) => k.key === "Cycles")?.value).toBe("2");
  });

  it("uses the configured API version threshold", async () => {
    const { candidates } = await run([cls("A", 58)], [], withConfig({ code: { apiVersionThreshold: 65 } }));
    expect(candidates.map((c) => c.ruleKey)).toEqual(["CodeHealth.OldApiVersion"]);
  });

  it("copes with a few hundred classes", async () => {
    const nodes = Array.from({ length: 300 }, (_, i) => cls(`C${i}`, i % 2 === 0 ? 40 : 60));
    const { result } = await run(nodes);
    expect(result.kpis.find((k) => k.key === "OldApiVersion")?.value).toBe("150");
    expect(result.breakdown.caption).toBe("Top 8 of 150");
  });
});

describe("codeDrilldown", () => {
  it("lists the classes behind a KPI and falls back to a ranking", async () => {
    const { ctx } = await run([cls("Old", 40), cls("New")]);
    expect((await codeDrilldown(ctx, "OldApiVersion")).rows.map((r) => r.label)).toEqual(["Old"]);
    expect((await codeDrilldown(ctx, "whatever")).title).toBe("Classes ranked by dependencies");
  });
});
