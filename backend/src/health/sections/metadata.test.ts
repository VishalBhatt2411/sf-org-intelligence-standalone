import { describe, expect, it } from "vitest";
import { CONNECTION, NOW, healthGraph, withConfig, type NodeSpecT } from "../healthTestKit";
import type { EdgeSpec } from "../../graph/graphTestKit";
import { classify, computeMetadata, metadataDrilldown } from "./metadata";

const cfg = withConfig({ metadata: { fieldThreshold: 4, degreeThreshold: 2 } });
const object = (fqn: string, over: Partial<NodeSpecT> = {}): NodeSpecT => ({ kind: "CustomObject", fqn, attributes: { custom: true }, ...over });
const fields = (parent: string, n: number): NodeSpecT[] =>
  Array.from({ length: n }, (_, i) => ({ kind: "CustomField", fqn: `${parent}.F${i}__c`, parent: ["CustomObject", parent] as const }));
const lookup = (from: string, to: string): EdgeSpec => ({ type: "LOOKUP_TO", from: ["CustomObject", from], to: ["CustomObject", to] });

async function run(nodes: NodeSpecT[], edges: EdgeSpec[] = [], config = cfg) {
  const { graph } = await healthGraph(nodes, edges);
  const ctx = { graph, connectionId: CONNECTION, config, now: NOW };
  return { ctx, ...(await computeMetadata(ctx)) };
}

describe("classify", () => {
  it("separates managed, custom and standard objects", () => {
    expect(classify({ namespace: "ns", fqn: "ns__A__c", attributes: {} })).toBe("managed");
    expect(classify({ namespace: null, fqn: "A__c", attributes: {} })).toBe("custom");
    expect(classify({ namespace: null, fqn: "Account", attributes: { custom: false } })).toBe("standard");
  });
});

describe("computeMetadata", () => {
  it("reports no data, not a perfect score, when the graph has no objects", async () => {
    const { result, candidates } = await run([]);
    expect(result.score).toBeNull();
    expect(result.severity).toBeNull();
    expect(result.coverage.complete).toBe(false);
    expect(candidates).toEqual([]);
  });

  it("flags a high field count and proposes a finding with the measured value", async () => {
    const { result, candidates } = await run([object("Big__c"), ...fields("Big__c", 6), object("Ref__c")], [lookup("Ref__c", "Big__c")]);
    expect(result.kpis.find((k) => k.key === "HighFieldCount")?.value).toBe("1");
    const c = candidates.find((x) => x.ruleKey === "MetadataHealth.HighFieldCount")!;
    expect(c).toMatchObject({ section: "metadata", ruleVersion: 2, componentLabel: "Big__c", componentType: "Unmanaged Custom", measured: "6 custom fields", expected: "< 4 custom fields" });
    expect(c.evidence).toContain("configured threshold: 4");
  });

  it("does not flag an object just under the threshold", async () => {
    const { result, candidates } = await run([object("Ok__c"), ...fields("Ok__c", 3), object("Ref__c")], [lookup("Ref__c", "Ok__c")]);
    expect(candidates.filter((c) => c.ruleKey === "MetadataHealth.HighFieldCount")).toEqual([]);
    expect(result.kpis.find((k) => k.key === "HighFieldCount")?.value).toBe("0");
  });

  it("flags high incoming degree, counting distinct referencing objects", async () => {
    const { candidates } = await run([object("Hub__c"), object("A__c"), object("B__c"), object("C__c")], [lookup("A__c", "Hub__c"), lookup("B__c", "Hub__c"), lookup("C__c", "A__c")]);
    const hub = candidates.find((c) => c.ruleKey === "MetadataHealth.HighDegree");
    expect(hub?.componentLabel).toBe("Hub__c");
    expect(hub?.measured).toBe("2 incoming relationships");
  });

  it("flags objects nothing points at, as a low-confidence informational finding", async () => {
    const { candidates } = await run([object("Lonely__c")]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ ruleKey: "MetadataHealth.NoIncomingReferences", confidence: "low", expected: "Not applicable — informational, for review only" });
  });

  it("does not nag about managed-package objects with no references", async () => {
    const { result, candidates } = await run([object("Pkg__c", { namespace: "acme", fqn: "acme__Pkg__c" })]);
    expect(candidates).toEqual([]);
    expect(result.kpis.find((k) => k.key === "OrphanRate")?.value).toBe("0");
  });

  it("scores 100 minus the weighted share of breaching objects", async () => {
    // 1 of 2 objects is an orphan: 100 - (1/2 x 30) = 85; the other is referenced.
    const { result } = await run([object("A__c"), object("B__c")], [lookup("A__c", "B__c")]);
    expect(result.score).toBe(85);
    expect(result.severity).toBe("good");
  });

  it("ranks the worst objects first and caps the breakdown at 8 with a Top X of Y caption", async () => {
    const nodes = Array.from({ length: 12 }, (_, i) => object(`O${String(i).padStart(2, "0")}__c`));
    const { result } = await run(nodes);
    expect(result.breakdown.rows).toHaveLength(8);
    expect(result.breakdown.caption).toBe("Top 8 of 12");
    expect(result.heatmap.rows).toHaveLength(5);
  });

  it("reports partial coverage when the object ceiling is reached", async () => {
    const { result } = await run([object("A__c"), object("B__c"), object("C__c")], [], withConfig({ ceiling: 3, metadata: { fieldThreshold: 4, degreeThreshold: 2 } }));
    expect(result.coverage).toEqual({ complete: false, note: "3 objects scanned (ceiling reached — results may be incomplete)" });
  });

  it("handles a large org in one pass", async () => {
    const nodes = Array.from({ length: 400 }, (_, i) => object(`B${i}__c`));
    const { result } = await run(nodes, []);
    expect(result.coverage.note).toBe("400 / 400 objects scanned");
    expect(result.kpis.find((k) => k.key === "OrphanRate")?.value).toBe("400");
  });
});

describe("metadataDrilldown", () => {
  it("lists the objects behind a KPI, worst first, and falls back to degree ranking", async () => {
    const { ctx } = await run([object("A__c"), ...fields("A__c", 5), object("B__c"), ...fields("B__c", 7)], []);
    const high = await metadataDrilldown(ctx, "HighFieldCount");
    expect(high.title).toBe("High field-count objects");
    expect(high.rows.map((r) => r.label)).toEqual(["B__c", "A__c"]);
    expect(high.caption).toBe("2 objects");
    const fallback = await metadataDrilldown(ctx, "DependencyDensity");
    expect(fallback.title).toBe("Objects ranked by relationship degree");
  });

  it("explains a row with no breach in plain words", async () => {
    const { ctx } = await run([object("A__c"), object("B__c")], [lookup("A__c", "B__c")]);
    const all = await metadataDrilldown(ctx, "DependencyDensity");
    expect(all.rows.find((r) => r.label === "B__c")?.explanation).toBe("No thresholds breached — field count and connectivity are within this org's configured ranges.");
  });
});
