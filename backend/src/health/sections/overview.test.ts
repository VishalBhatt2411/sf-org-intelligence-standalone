import { describe, expect, it } from "vitest";
import { CONNECTION, NOW, healthGraph } from "../healthTestKit";
import { emptySection, type SectionResult } from "../types";
import { buildSummary, computeOverview } from "./overview";

describe("computeOverview", () => {
  it("says there is no data for an empty graph", async () => {
    const { graph } = await healthGraph([]);
    const r = await computeOverview({ graph, connectionId: CONNECTION, config: undefined as never, now: NOW });
    expect(r).toMatchObject({ section: "overview", scored: false, score: null });
    expect(r.kpis).toEqual([]);
    expect(r.coverage.complete).toBe(false);
  });

  it("counts nodes and dependency edges from the graph", async () => {
    const { graph } = await healthGraph(
      [{ kind: "CustomObject", fqn: "Account" }, { kind: "ApexClass", fqn: "A" }, { kind: "ApexClass", fqn: "B" }, { kind: "Flow", fqn: "F" }],
      [{ type: "REFERENCES", from: ["ApexClass", "A"], to: ["ApexClass", "B"] }, { type: "DEPENDS_ON", from: ["Flow", "F"], to: ["CustomObject", "Account"] }],
    );
    const r = await computeOverview({ graph, connectionId: CONNECTION, config: undefined as never, now: NOW });
    const v = (k: string) => r.kpis.find((x) => x.key === k)?.value;
    expect(v("Objects")).toBe("1");
    expect(v("ApexClasses")).toBe("2");
    expect(v("Flows")).toBe("1");
    expect(v("DependencyEdges")).toBe("2");
  });
});

describe("buildSummary", () => {
  it("returns one card per section, marks sections nobody has run, and surfaces the top signal", () => {
    const code: SectionResult = emptySection("code", "Code", { scored: true, score: 55, severity: "warning" });
    code.breakdown.rows = [{ key: "A", label: "A", componentType: "Apex Class", severity: "warning", metrics: [], explanation: "too many dependencies" }];
    const cards = buildSummary({ code });
    expect(cards.map((c) => c.section)).toEqual(["overview", "metadata", "automation", "code", "security", "data", "storage"]);
    expect(cards.find((c) => c.section === "code")).toMatchObject({ score: 55, severity: "warning", topSignal: "A: too many dependencies" });
    const data = cards.find((c) => c.section === "data")!;
    expect(data).toMatchObject({ score: null, computedAt: null, live: true });
    expect(data.note).toContain("Not run yet");
  });
});
