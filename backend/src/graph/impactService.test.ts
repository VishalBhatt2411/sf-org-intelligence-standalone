import { describe, expect, it } from "vitest";
import type { GraphCoverage } from "./graphReadRepository";
import { edgeRow, keyOfRef, seed, type EdgeSpec, type Ref } from "./graphTestKit";
import { IMPACT_NODE_CAP, ImpactService, coverageCaveats } from "./impactService";
import { InMemoryGraphRepository } from "./inMemoryGraphRepository";

const C = "c1";
const obj: Ref = ["CustomObject", "Invoice__c"];
const field: Ref = ["CustomField", "Invoice__c.Amount__c"];
const cls = (n: string): Ref => ["ApexClass", n];
const trg = (n: string): Ref => ["ApexTrigger", n];
const ref = (from: Ref, to: Ref, confidence?: EdgeSpec["confidence"]): EdgeSpec => ({ type: "REFERENCES", from, to, confidence });
const labels = (r: { nodes: Array<{ label: string }> }) => r.nodes.map((n) => n.label);
const codes = (r: { caveats: Array<{ code: string }> }) => r.caveats.map((c) => c.code);

// Svc -> Invoice__c, Ctl -> Svc, InvoiceTrg executes on Invoice__c; the field belongs to the object.
async function fixture() {
  const repo = new InMemoryGraphRepository();
  await seed(repo, C, [obj, field, cls("Svc"), cls("Ctl"), trg("InvoiceTrg"), cls("Unrelated")], [
    ref(cls("Svc"), obj),
    ref(cls("Ctl"), cls("Svc")),
    { type: "EXECUTES_ON", from: trg("InvoiceTrg"), to: obj },
    { type: "HAS_FIELD", from: obj, to: field },
  ]);
  return { repo, service: new ImpactService(repo) };
}

describe("ImpactService.analyze", () => {
  it("downstream finds what references or runs on the node, with its distance", async () => {
    const { service } = await fixture();
    const result = (await service.analyze(C, keyOfRef(obj)))!;
    expect(result.direction).toBe("downstream");
    expect(result.nodes.map((n) => [n.label, n.distance])).toEqual([["InvoiceTrg", 1], ["Svc", 1], ["Ctl", 2]]);
    expect(result.root.label).toBe("Invoice__c");
    expect(result.edges).toHaveLength(3);
  });

  it("upstream finds what the node relies on", async () => {
    const { service } = await fixture();
    const result = (await service.analyze(C, keyOfRef(cls("Ctl")), { direction: "upstream", depth: 3 }))!;
    expect(result.nodes.map((n) => [n.label, n.distance])).toEqual([["Svc", 1], ["Invoice__c", 2]]);
  });

  it("does not follow structural edges, so a field is not impacted by its object", async () => {
    const { service } = await fixture();
    const down = (await service.analyze(C, keyOfRef(obj), { depth: 3 }))!;
    expect(labels(down)).not.toContain("Amount__c");
    const up = (await service.analyze(C, keyOfRef(field), { direction: "upstream" }))!;
    expect(up.nodes).toHaveLength(0);
  });

  it("limits the walk to the depth and clamps it to 1..3", async () => {
    const { service } = await fixture();
    expect(labels((await service.analyze(C, keyOfRef(obj), { depth: 1 }))!)).toEqual(["InvoiceTrg", "Svc"]);
    expect((await service.analyze(C, keyOfRef(obj), { depth: 50 }))!.depth).toBe(3);
    expect((await service.analyze(C, keyOfRef(obj), { depth: 0 }))!.depth).toBe(1);
  });

  it("summarises the result by node type, largest first", async () => {
    const { service } = await fixture();
    const result = (await service.analyze(C, keyOfRef(obj)))!;
    expect(result.summary.map((s) => [s.kindLabel, s.count])).toEqual([["Apex Class", 2], ["Apex Trigger", 1]]);
  });

  it("returns null for an unknown, stale or foreign node", async () => {
    const { repo, service } = await fixture();
    expect(await service.analyze(C, keyOfRef(cls("Nope")))).toBeNull();
    expect(await service.analyze("c2", keyOfRef(obj))).toBeNull();
    repo.nodes.get(`${C}\u0000${keyOfRef(obj)}`)!.state = "stale";
    expect(await service.analyze(C, keyOfRef(obj))).toBeNull();
  });

  it("ignores stale links and other connections", async () => {
    const { repo, service } = await fixture();
    await seed(repo, "c2", [obj, cls("Foreign")], [ref(cls("Foreign"), obj)]);
    repo.edges.get(`${C}\u0000${edgeRow(ref(cls("Svc"), obj)).edgeKey}`)!.state = "stale";
    expect(labels((await service.analyze(C, keyOfRef(obj)))!)).toEqual(["InvoiceTrg"]);
  });

  it("detects a cycle and names the nodes on it", async () => {
    const repo = new InMemoryGraphRepository();
    const [a, b, c, d] = ["A", "B", "C", "D"].map(cls);
    await seed(repo, C, [a, b, c, d], [ref(a, b), ref(b, c), ref(c, a), ref(d, a)]);
    const result = (await new ImpactService(repo).analyze(C, keyOfRef(a), { depth: 3 }))!;
    expect(result.hasCycle).toBe(true);
    expect(result.cycleNodeKeys).toEqual([a, b, c].map(keyOfRef).sort());
  });

  it("treats a self-reference as a cycle and a plain chain as none", async () => {
    const repo = new InMemoryGraphRepository();
    const [a, b] = ["A", "B"].map(cls);
    await seed(repo, C, [a, b], [ref(a, a), ref(b, a)]);
    const looped = (await new ImpactService(repo).analyze(C, keyOfRef(a)))!;
    expect(looped.cycleNodeKeys).toEqual([keyOfRef(a)]);
    const { service } = await fixture();
    const chain = (await service.analyze(C, keyOfRef(obj)))!;
    expect(chain.hasCycle).toBe(false);
    expect(chain.cycleNodeKeys).toEqual([]);
  });

  it("caps the result and says so, keeping edges inside what was returned", async () => {
    const repo = new InMemoryGraphRepository();
    const names = Array.from({ length: IMPACT_NODE_CAP + 60 }, (_, i) => `U${String(i).padStart(4, "0")}`);
    await seed(repo, C, [obj, ...names.map(cls)], names.map((n) => ref(cls(n), obj)));
    const result = (await new ImpactService(repo).analyze(C, keyOfRef(obj)))!;
    expect(result.nodes).toHaveLength(IMPACT_NODE_CAP);
    expect(result.truncated).toBe(true);
    expect(result.edges).toHaveLength(IMPACT_NODE_CAP);
    expect(codes(result)).toContain("truncated");
    // The same nodes survive the cap every time.
    const again = (await new ImpactService(repo).analyze(C, keyOfRef(obj)))!;
    expect(again.nodes.map((n) => n.nodeKey)).toEqual(result.nodes.map((n) => n.nodeKey));
  });

  it("always states the scope, and warns about heuristic links only when present", async () => {
    const { service } = await fixture();
    const plain = (await service.analyze(C, keyOfRef(obj)))!;
    expect(codes(plain)).toEqual(expect.arrayContaining(["scope", "no-scan"]));
    expect(codes(plain)).not.toContain("heuristic");
    const repo = new InMemoryGraphRepository();
    await seed(repo, C, [obj, cls("Guess")], [ref(cls("Guess"), obj, "heuristic")]);
    expect(codes((await new ImpactService(repo).analyze(C, keyOfRef(obj)))!)).toContain("heuristic");
  });

  it("adds a caveat for each partial or degraded scan stage", async () => {
    const { repo, service } = await fixture();
    repo.coverage.set(C, {
      scanId: "s1",
      finishedAt: new Date(),
      stages: [
        { category: "graph_apex", coverage: "partial", detail: "12 of 40 classes", itemCount: 12 },
        { category: "graph_flows", coverage: "degraded", detail: null, itemCount: 0 },
        { category: "graph_objects", coverage: "complete", detail: null, itemCount: 9 },
      ],
    });
    const result = (await service.analyze(C, keyOfRef(obj)))!;
    expect(codes(result)).not.toContain("no-scan");
    expect(result.caveats.filter((c) => c.code.startsWith("coverage-")).map((c) => c.message)).toEqual([
      "apex was partial in the last scan (12 of 40 classes), so results may be missing links.",
      "flows was degraded in the last scan, so results may be missing links.",
    ]);
  });
});

describe("coverageCaveats", () => {
  it("reports no caveat when every stage is complete or unrecorded", () => {
    const coverage: GraphCoverage = {
      scanId: "s",
      finishedAt: null,
      stages: [
        { category: "graph_objects", coverage: "complete", detail: null, itemCount: 1 },
        { category: "graph_x", coverage: null, detail: null, itemCount: 0 },
      ],
    };
    expect(coverageCaveats(coverage)).toEqual([]);
  });
});
