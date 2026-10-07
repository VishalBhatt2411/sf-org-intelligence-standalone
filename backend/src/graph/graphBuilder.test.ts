import { describe, expect, it } from "vitest";
import { GraphBuildSession } from "./graphBuilder";
import { InMemoryGraphRepository } from "./inMemoryGraphRepository";
import { dedupeEdges, edgeDraft, keyOf, nodeDraft } from "./draft";
import { emptyOutput, type ScannerOutput } from "./types";

const CONN = "conn-1";

function out(nodes: Array<[kind: "CustomObject" | "ApexClass", fqn: string, label?: string]>, edges: Array<[from: string, to: string]> = []): ScannerOutput {
  const o = emptyOutput();
  for (const [kind, fqn, label] of nodes) o.nodes.push(nodeDraft(kind, { fqn, label: label ?? fqn }).draft);
  o.edges = dedupeEdges(edges.map(([a, b]) => edgeDraft("REFERENCES", keyOf("ApexClass", a), keyOf("ApexClass", b))));
  return o;
}

const session = (repo: InMemoryGraphRepository, scanId: string, connectionId = CONN) => new GraphBuildSession(repo, connectionId, scanId);
const states = (repo: InMemoryGraphRepository) => [...repo.nodes.values()].map((n) => `${n.fqn}:${n.state}`).sort();

describe("GraphBuildSession.applyStage", () => {
  it("creates nodes and edges on the first scan", async () => {
    const repo = new InMemoryGraphRepository();
    const stats = await session(repo, "s1").applyStage(out([["ApexClass", "A"], ["ApexClass", "B"]], [["A", "B"]]));
    expect(stats).toEqual({ nodes: { created: 2, updated: 0, unchanged: 0 }, edges: { created: 1, updated: 0, unchanged: 0 }, droppedEdges: 0 });
    expect([...repo.nodes.values()][0]).toMatchObject({ state: "active", firstSeenScanId: "s1", lastSeenScanId: "s1" });
  });

  it("only stamps unchanged rows on a re-scan", async () => {
    const repo = new InMemoryGraphRepository();
    const input = out([["ApexClass", "A"], ["ApexClass", "B"]], [["A", "B"]]);
    await session(repo, "s1").applyStage(input);
    const before = { ...repo.calls };
    const stats = await session(repo, "s2").applyStage(input);
    expect(stats.nodes).toEqual({ created: 0, updated: 0, unchanged: 2 });
    expect(repo.calls.updateNodes - before.updateNodes).toBe(1);
    expect([...repo.nodes.values()].every((n) => n.lastSeenScanId === "s2" && n.firstSeenScanId === "s1")).toBe(true);
  });

  it("rewrites a node whose content changed and keeps firstSeenScanId", async () => {
    const repo = new InMemoryGraphRepository();
    await session(repo, "s1").applyStage(out([["ApexClass", "A", "Old"]]));
    const stats = await session(repo, "s2").applyStage(out([["ApexClass", "A", "New"]]));
    expect(stats.nodes).toEqual({ created: 0, updated: 1, unchanged: 0 });
    expect([...repo.nodes.values()][0]).toMatchObject({ label: "New", firstSeenScanId: "s1", lastSeenScanId: "s2" });
  });

  it("detects changed edge attributes and confidence", async () => {
    const repo = new InMemoryGraphRepository();
    const make = (confidence: "exact" | "heuristic", events: string[]) => {
      const o = out([["ApexClass", "A"], ["ApexClass", "B"]]);
      o.edges = [edgeDraft("REFERENCES", keyOf("ApexClass", "A"), keyOf("ApexClass", "B"), { confidence, attributes: { events } })];
      return o;
    };
    await session(repo, "s1").applyStage(make("heuristic", ["x"]));
    expect((await session(repo, "s2").applyStage(make("heuristic", ["x"]))).edges.unchanged).toBe(1);
    expect((await session(repo, "s3").applyStage(make("heuristic", ["y"]))).edges.updated).toBe(1);
    expect((await session(repo, "s4").applyStage(make("exact", ["y"]))).edges.updated).toBe(1);
  });

  it("reactivates a stale row that comes back unchanged", async () => {
    const repo = new InMemoryGraphRepository();
    const input = out([["ApexClass", "A"]]);
    await session(repo, "s1").applyStage(input);
    const s2 = session(repo, "s2");
    await s2.retire(["SalesforceMetadata.ApexClass"], []);
    expect(states(repo)).toEqual(["A:stale"]);
    await session(repo, "s3").applyStage(input);
    expect(states(repo)).toEqual(["A:active"]);
  });

  it("drops an edge whose endpoint was not emitted and reports it", async () => {
    const repo = new InMemoryGraphRepository();
    const stats = await session(repo, "s1").applyStage(out([["ApexClass", "A"]], [["A", "Missing"]]));
    expect(stats.droppedEdges).toBe(1);
    expect(repo.edges.size).toBe(0);
  });

  it("lets a later stage link to nodes an earlier stage emitted, but not to ones that were rolled back", async () => {
    const repo = new InMemoryGraphRepository();
    const s = session(repo, "s1");
    await s.applyStage(out([["ApexClass", "A"]]));
    const later = out([["ApexClass", "B"]], [["B", "A"]]);
    expect((await s.applyStage(later)).droppedEdges).toBe(0);

    const failing = new InMemoryGraphRepository();
    const realCreate = failing.createNodes.bind(failing);
    failing.createNodes = async () => {
      failing.createNodes = realCreate;
      throw new Error("boom");
    };
    const s2 = session(failing, "s1");
    await expect(s2.applyStage(out([["ApexClass", "A"]]))).rejects.toThrow("boom");
    expect((await s2.applyStage(out([["ApexClass", "C"]], [["C", "A"]]))).droppedEdges).toBe(1);
  });

  it("rolls the whole stage back when a write fails", async () => {
    const repo = new InMemoryGraphRepository();
    repo.createEdges = async () => {
      throw new Error("edge write failed");
    };
    await expect(session(repo, "s1").applyStage(out([["ApexClass", "A"], ["ApexClass", "B"]], [["A", "B"]]))).rejects.toThrow("edge write failed");
    expect(repo.nodes.size).toBe(0);
  });

  it("collapses duplicate nodes and edges within a stage", async () => {
    const repo = new InMemoryGraphRepository();
    const o = out([["ApexClass", "A"], ["ApexClass", "A"], ["ApexClass", "B"]], [["A", "B"]]);
    o.edges.push(o.edges[0]);
    const stats = await session(repo, "s1").applyStage(o);
    expect(stats.nodes.created).toBe(2);
    expect(stats.edges.created).toBe(1);
  });

  it("keeps connections apart", async () => {
    const repo = new InMemoryGraphRepository();
    await session(repo, "s1", "c1").applyStage(out([["ApexClass", "A"]]));
    await session(repo, "s1", "c2").applyStage(out([["ApexClass", "A"]]));
    expect(repo.nodes.size).toBe(2);
    await session(repo, "s2", "c1").retire(["SalesforceMetadata.ApexClass"], []);
    expect([...repo.nodes.entries()].filter(([, n]) => n.state === "stale")).toHaveLength(1);
  });

  it("handles an empty stage and a large one", async () => {
    const repo = new InMemoryGraphRepository();
    expect((await session(repo, "s1").applyStage(emptyOutput())).nodes.created).toBe(0);
    const names = Array.from({ length: 3000 }, (_, i) => `C${i}`);
    const big = out(names.map((n) => ["ApexClass", n] as ["ApexClass", string]), names.slice(1).map((n, i) => [names[i], n] as [string, string]));
    const stats = await session(repo, "s2").applyStage(big);
    expect(stats.nodes.created).toBe(3000);
    expect(stats.edges.created).toBe(2999);
  });
});

describe("GraphBuildSession.retire", () => {
  const A = "SalesforceMetadata.ApexClass";
  const refs = { typeKey: "SalesforceMetadata.REFERENCES", sourceTypeKey: A };

  it("retires only the given types, and only rows this scan did not see", async () => {
    const repo = new InMemoryGraphRepository();
    await session(repo, "s1").applyStage(out([["ApexClass", "A"], ["ApexClass", "B"], ["CustomObject", "Obj"]]));
    const s2 = session(repo, "s2");
    await s2.applyStage(out([["ApexClass", "A"]]));
    expect(await s2.retire([A], [])).toEqual({ nodes: 1, edges: 0 });
    expect(states(repo)).toEqual(["A:active", "B:stale", "Obj:active"]);
  });

  it("retires unseen edges in scope and the edges of retired nodes", async () => {
    const repo = new InMemoryGraphRepository();
    await session(repo, "s1").applyStage(out([["ApexClass", "A"], ["ApexClass", "B"], ["ApexClass", "C"]], [["A", "B"], ["A", "C"]]));
    const s2 = session(repo, "s2");
    await s2.applyStage(out([["ApexClass", "A"], ["ApexClass", "B"]], [["A", "B"]]));
    const result = await s2.retire([A], [refs]);
    expect(result).toEqual({ nodes: 1, edges: 1 });
    const stale = [...repo.edges.values()].filter((e) => e.state === "stale");
    expect(stale).toHaveLength(1);
    expect(stale[0].targetNodeKey).toBe(keyOf("ApexClass", "C"));
  });

  it("leaves unseen edges alone when their scope is not listed or the source type differs", async () => {
    const repo = new InMemoryGraphRepository();
    await session(repo, "s1").applyStage(out([["ApexClass", "A"], ["ApexClass", "B"]], [["A", "B"]]));
    const s2 = session(repo, "s2");
    await s2.applyStage(out([["ApexClass", "A"], ["ApexClass", "B"]]));
    await s2.retire([], [{ typeKey: "SalesforceMetadata.REFERENCES", sourceTypeKey: "SalesforceMetadata.ApexTrigger" }]);
    expect([...repo.edges.values()][0].state).toBe("active");
    await s2.retire([], [{ typeKey: "SalesforceMetadata.REFERENCES", sourceTypeKey: null }]);
    expect([...repo.edges.values()][0].state).toBe("stale");
  });

  it("is a no-op for nothing to retire", async () => {
    const repo = new InMemoryGraphRepository();
    expect(await session(repo, "s1").retire([], [])).toEqual({ nodes: 0, edges: 0 });
  });
});
