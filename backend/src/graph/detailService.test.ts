import { describe, expect, it } from "vitest";
import { DETAIL_EDGE_LIST, DetailService } from "./detailService";
import { GraphNotFoundError } from "./errors";
import { keyOfRef, seed, type EdgeSpec, type Ref } from "./graphTestKit";
import { InMemoryGraphRepository } from "./inMemoryGraphRepository";

const C = "c1";
const obj: Ref = ["CustomObject", "Invoice__c"];
const field: Ref = ["CustomField", "Invoice__c.Amount__c"];
const cls = (n: string): Ref => ["ApexClass", n];
const ref = (from: Ref, to: Ref, confidence?: EdgeSpec["confidence"]): EdgeSpec => ({ type: "REFERENCES", from, to, confidence });

async function fixture() {
  const repo = new InMemoryGraphRepository();
  await seed(repo, C, [obj, [field[0], field[1], obj], cls("A"), cls("B"), cls("C")], [
    { type: "HAS_FIELD", from: obj, to: field },
    ref(cls("A"), obj),
    ref(cls("B"), obj, "heuristic"),
    ref(cls("C"), obj, "heuristic"),
    ref(obj, cls("C")),
  ]);
  return { repo, service: new DetailService(repo) };
}

describe("DetailService.nodeDetail", () => {
  it("returns the node, its parent, and related edges with direction and the other end", async () => {
    const { service } = await fixture();
    const detail = await service.nodeDetail(C, keyOfRef(field));
    expect(detail.node.fqn).toBe("Invoice__c.Amount__c");
    expect(detail.parent?.label).toBe("Invoice__c");
    expect(detail.edges).toHaveLength(1);
    expect(detail.edges[0]).toMatchObject({ direction: "in", kind: "HAS_FIELD", other: { label: "Invoice__c", kindLabel: "Object" } });
  });

  it("has no parent for a top-level node", async () => {
    const { service } = await fixture();
    expect((await service.nodeDetail(C, keyOfRef(obj))).parent).toBeNull();
  });

  it("summarises edges by type and direction with confidence counts and role labels", async () => {
    const { service } = await fixture();
    const detail = await service.nodeDetail(C, keyOfRef(obj));
    expect(detail.edgeTotal).toBe(5);
    expect(detail.capped).toBe(false);
    const refIn = detail.edgeSummary.find((r) => r.kind === "REFERENCES" && r.direction === "in")!;
    expect(refIn).toMatchObject({ count: 3, confidence: { exact: 1, parsed: 0, heuristic: 2 } });
    expect(refIn.role).toBe("Referenced By");
    expect(detail.edgeSummary.find((r) => r.kind === "REFERENCES" && r.direction === "out")!.count).toBe(1);
    expect(detail.edgeSummary[0].count).toBeGreaterThanOrEqual(detail.edgeSummary[1].count);
  });

  it("lists at most the first 100 edges but still counts them all", async () => {
    const repo = new InMemoryGraphRepository();
    const names = Array.from({ length: 130 }, (_, i) => `H${String(i).padStart(3, "0")}`);
    await seed(repo, C, [obj, ...names.map(cls)], names.map((n) => ref(cls(n), obj)));
    const detail = await new DetailService(repo).nodeDetail(C, keyOfRef(obj));
    expect(detail.edges).toHaveLength(DETAIL_EDGE_LIST);
    expect(detail.edgeTotal).toBe(130);
    expect(detail.edgeSummary[0].count).toBe(130);
  });

  it("throws not-found for an unknown, stale or foreign node", async () => {
    const { repo, service } = await fixture();
    await expect(service.nodeDetail(C, keyOfRef(cls("Nope")))).rejects.toBeInstanceOf(GraphNotFoundError);
    await expect(service.nodeDetail("c2", keyOfRef(obj))).rejects.toBeInstanceOf(GraphNotFoundError);
    repo.nodes.get(`${C}\u0000${keyOfRef(obj)}`)!.state = "stale";
    await expect(service.nodeDetail(C, keyOfRef(obj))).rejects.toBeInstanceOf(GraphNotFoundError);
  });
});

describe("DetailService.summary", () => {
  it("counts active nodes and edges by type, largest first", async () => {
    const { service } = await fixture();
    const summary = await service.summary(C);
    expect(summary.totalNodes).toBe(5);
    expect(summary.totalEdges).toBe(5);
    expect(summary.nodesByType[0]).toMatchObject({ kind: "ApexClass", kindLabel: "Apex Class", count: 3 });
    expect(summary.edgesByType[0]).toMatchObject({ kind: "REFERENCES", count: 4 });
  });

  it("reports none before any scan and an empty graph for a connection with no data", async () => {
    const { service } = await fixture();
    expect(await service.summary(C)).toMatchObject({ coverage: "none", lastScan: null, stages: [] });
    expect(await service.summary("c2")).toMatchObject({ totalNodes: 0, totalEdges: 0, nodesByType: [], edgesByType: [] });
  });

  it("reports the weakest stage as the overall coverage", async () => {
    const { repo, service } = await fixture();
    const finishedAt = new Date("2026-01-02T03:04:05.000Z");
    repo.coverage.set(C, {
      scanId: "s1",
      finishedAt,
      stages: [
        { category: "graph_objects", coverage: "complete", detail: null, itemCount: 5 },
        { category: "graph_apex", coverage: "partial", detail: null, itemCount: 2 },
        { category: "graph_flows", coverage: null, detail: null, itemCount: 0 },
      ],
    });
    expect(await service.summary(C)).toMatchObject({ coverage: "partial", lastScan: { scanId: "s1", finishedAt: finishedAt.toISOString() } });
    repo.coverage.get(C)!.stages.push({ category: "graph_x", coverage: "degraded", detail: null, itemCount: 0 });
    expect((await service.summary(C)).coverage).toBe("degraded");
  });

  it("excludes stale nodes from the counts", async () => {
    const { repo, service } = await fixture();
    repo.nodes.get(`${C}\u0000${keyOfRef(cls("A"))}`)!.state = "stale";
    expect((await service.summary(C)).totalNodes).toBe(4);
  });
});
