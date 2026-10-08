import { describe, expect, it } from "vitest";
import { edgeTypeKey } from "../graph/nodeTypes";
import { CONNECTION, healthGraph, keyFor } from "./healthTestKit";

const REL = [edgeTypeKey("LOOKUP_TO"), edgeTypeKey("MASTER_DETAIL_TO")];
const obj = (fqn: string) => ({ kind: "CustomObject", fqn });
const field = (parent: string, name: string) => ({ kind: "CustomField", fqn: `${parent}.${name}`, parent: ["CustomObject", parent] as const });
const cls = (fqn: string) => ({ kind: "ApexClass", fqn });

describe("InMemoryHealthGraph", () => {
  it("counts only custom (__c) fields per parent object", async () => {
    const { graph } = await healthGraph([obj("A__c"), obj("B__c"), field("A__c", "X__c"), field("A__c", "Y__c"), field("A__c", "Name"), field("B__c", "Z__c")]);
    const counts = await graph.customFieldCounts(CONNECTION, [keyFor("CustomObject", "A__c"), keyFor("CustomObject", "B__c")]);
    expect(counts.get(keyFor("CustomObject", "A__c"))).toBe(2);
    expect(counts.get(keyFor("CustomObject", "B__c"))).toBe(1);
  });

  it("counts distinct incoming sources across edge types, not edges", async () => {
    const { graph } = await healthGraph(
      [obj("A__c"), obj("B__c"), obj("T__c")],
      [
        { type: "LOOKUP_TO", from: ["CustomObject", "A__c"], to: ["CustomObject", "T__c"] },
        { type: "MASTER_DETAIL_TO", from: ["CustomObject", "A__c"], to: ["CustomObject", "T__c"] },
        { type: "LOOKUP_TO", from: ["CustomObject", "B__c"], to: ["CustomObject", "T__c"] },
      ],
    );
    const counts = await graph.incomingCounts(CONNECTION, [keyFor("CustomObject", "T__c"), keyFor("CustomObject", "A__c")], REL);
    expect(counts.get(keyFor("CustomObject", "T__c"))).toBe(2);
    expect(counts.has(keyFor("CustomObject", "A__c"))).toBe(false);
  });

  it("reports distinct partners in both directions", async () => {
    const { graph } = await healthGraph(
      [cls("A"), cls("B"), cls("C")],
      [
        { type: "REFERENCES", from: ["ApexClass", "A"], to: ["ApexClass", "B"] },
        { type: "DEPENDS_ON", from: ["ApexClass", "A"], to: ["ApexClass", "B"] },
        { type: "REFERENCES", from: ["ApexClass", "C"], to: ["ApexClass", "A"] },
      ],
    );
    const n = await graph.neighbourCounts(CONNECTION, [keyFor("ApexClass", "A")], [edgeTypeKey("REFERENCES"), edgeTypeKey("DEPENDS_ON")]);
    expect(n.get(keyFor("ApexClass", "A"))).toEqual({ out: 1, in: 1 });
  });

  it("returns only edges with both ends in the set, and none for no edge types", async () => {
    const { graph } = await healthGraph(
      [cls("A"), cls("B"), cls("C")],
      [
        { type: "REFERENCES", from: ["ApexClass", "A"], to: ["ApexClass", "B"] },
        { type: "REFERENCES", from: ["ApexClass", "B"], to: ["ApexClass", "C"] },
      ],
    );
    const pairs = await graph.edgesAmong(CONNECTION, [keyFor("ApexClass", "A"), keyFor("ApexClass", "B")], [edgeTypeKey("REFERENCES")]);
    expect(pairs).toEqual([[keyFor("ApexClass", "A"), keyFor("ApexClass", "B")]]);
    expect(await graph.edgesAmong(CONNECTION, [keyFor("ApexClass", "A")], [])).toEqual([]);
  });

  it("counts executing sources per target object", async () => {
    const { graph } = await healthGraph(
      [{ kind: "ApexTrigger", fqn: "T1" }, { kind: "Flow", fqn: "F1" }, obj("Account")],
      [
        { type: "EXECUTES_ON", from: ["ApexTrigger", "T1"], to: ["CustomObject", "Account"] },
        { type: "EXECUTES_ON", from: ["Flow", "F1"], to: ["CustomObject", "Account"] },
      ],
    );
    const m = await graph.executionTargets(CONNECTION, [keyFor("ApexTrigger", "T1"), keyFor("Flow", "F1")], edgeTypeKey("EXECUTES_ON"));
    expect(m.get(keyFor("CustomObject", "Account"))).toBe(2);
  });

  it("is scoped to its connection", async () => {
    const { graph } = await healthGraph([obj("A__c"), field("A__c", "X__c")]);
    expect((await graph.customFieldCounts("other", [keyFor("CustomObject", "A__c")])).size).toBe(0);
  });
});
