import { describe, expect, it } from "vitest";
import type { EdgeSpec } from "../../graph/graphTestKit";
import { CONNECTION, NOW, healthGraph, withConfig, type NodeSpecT } from "../healthTestKit";
import { automationDrilldown, computeAutomation } from "./automation";

const cfg = withConfig({ automation: { dependencyThreshold: 3 } });
const trigger = (fqn: string): NodeSpecT => ({ kind: "ApexTrigger", fqn });
const flow = (fqn: string): NodeSpecT => ({ kind: "Flow", fqn });
const refs = (from: [string, string], to: [string, string]): EdgeSpec => ({ type: "REFERENCES", from, to });

async function run(nodes: NodeSpecT[], edges: EdgeSpec[] = [], config = cfg) {
  const { graph } = await healthGraph(nodes, edges);
  const ctx = { graph, connectionId: CONNECTION, config, now: NOW };
  return { ctx, ...(await computeAutomation(ctx)) };
}

describe("computeAutomation", () => {
  it("returns an unscored 'no data' section for an empty graph", async () => {
    const { result } = await run([]);
    expect(result.scored).toBe(false);
    expect(result.score).toBeNull();
    expect(result.coverage.complete).toBe(false);
  });

  it("counts triggers and flows and never scores", async () => {
    const { result } = await run([trigger("T1"), trigger("T2"), flow("F1")]);
    expect(result.score).toBeNull();
    expect(result.kpis.find((k) => k.key === "Triggers")?.value).toBe("2");
    expect(result.kpis.find((k) => k.key === "Flows")?.value).toBe("1");
    expect(result.coverage.note).toBe("3 / 3 automation components scanned");
  });

  it("flags a component whose fan-in plus fan-out reaches the threshold", async () => {
    const nodes = [trigger("Hub"), flow("A"), flow("B"), flow("C")];
    const { result, candidates } = await run(nodes, [refs(["ApexTrigger", "Hub"], ["Flow", "A"]), refs(["ApexTrigger", "Hub"], ["Flow", "B"]), refs(["Flow", "C"], ["ApexTrigger", "Hub"])]);
    expect(result.kpis.find((k) => k.key === "HighDependency")?.value).toBe("1");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ ruleKey: "AutomationHealth.HighDependency", componentLabel: "Hub", componentType: "Apex Trigger", measured: "3 combined fan-in/fan-out", expected: "< 3 combined fan-in/fan-out" });
  });

  it("does not flag a component just below the threshold", async () => {
    const { candidates } = await run([trigger("T"), flow("A"), flow("B")], [refs(["ApexTrigger", "T"], ["Flow", "A"]), refs(["ApexTrigger", "T"], ["Flow", "B"])]);
    expect(candidates).toEqual([]);
  });

  it("flags every member of a dependency cycle and ranks cycles first", async () => {
    const { result, candidates } = await run([flow("A"), flow("B"), flow("C")], [refs(["Flow", "A"], ["Flow", "B"]), refs(["Flow", "B"], ["Flow", "A"])]);
    expect(candidates.map((c) => c.componentLabel).sort()).toEqual(["A", "B"]);
    expect(candidates.every((c) => c.ruleKey === "AutomationHealth.DependencyCycle" && c.expected.startsWith("Not applicable"))).toBe(true);
    expect(result.kpis.find((k) => k.key === "Cycles")?.value).toBe("2");
    expect(result.breakdown.rows.map((r) => r.label)).not.toContain("C");
  });

  it("names the object with the most automation attached", async () => {
    const { result } = await run(
      [trigger("T1"), flow("F1"), { kind: "CustomObject", fqn: "Account" }],
      [
        { type: "EXECUTES_ON", from: ["ApexTrigger", "T1"], to: ["CustomObject", "Account"] },
        { type: "EXECUTES_ON", from: ["Flow", "F1"], to: ["CustomObject", "Account"] },
      ],
    );
    expect(result.kpis.find((k) => k.key === "MostAutomatedObject")?.value).toBe("Account (2)");
  });

  it("says 'None detected' when nothing executes on an object", async () => {
    const { result } = await run([trigger("T1")]);
    expect(result.kpis.find((k) => k.key === "MostAutomatedObject")?.value).toBe("None detected");
  });

  it("notes partial coverage at the ceiling", async () => {
    const { result } = await run([trigger("T1"), trigger("T2")], [], withConfig({ ceiling: 2 }));
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.note).toContain("ceiling reached");
  });

  it("keeps the breakdown to 8 rows for a large org", async () => {
    const flows = Array.from({ length: 30 }, (_, i) => flow(`F${i}`));
    const edges = flows.slice(1).map((_, i): EdgeSpec => refs(["Flow", `F${i}`], ["Flow", `F${i + 1}`]));
    edges.push(refs(["Flow", "F29"], ["Flow", "F0"]));
    const { result } = await run(flows, edges);
    expect(result.breakdown.rows).toHaveLength(8);
    expect(result.breakdown.caption).toBe("Top 8 of 30");
  });
});

describe("automationDrilldown", () => {
  it("lists cycle members for the Cycles metric", async () => {
    const { ctx } = await run([flow("A"), flow("B")], [refs(["Flow", "A"], ["Flow", "B"]), refs(["Flow", "B"], ["Flow", "A"])]);
    const d = await automationDrilldown(ctx, "Cycles");
    expect(d.title).toBe("Components in dependency cycles");
    expect(d.rows).toHaveLength(2);
  });
});
