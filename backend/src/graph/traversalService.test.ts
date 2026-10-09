import { describe, expect, it } from "vitest";
import { GraphInputError } from "./errors";
import { edgeRow, keyOfRef, nodeKeys, nodeRow, seed, type EdgeSpec, type Ref } from "./graphTestKit";
import { InMemoryGraphRepository } from "./inMemoryGraphRepository";
import { typeKeyOf } from "./keys";
import { EXPAND_NODE_CAP, MAX_HOPS, RING_EDGE_CAP, TraversalService, type RingNode } from "./traversalService";

const C = "c1";
const cls = (n: string): Ref => ["ApexClass", n];
const ref = (from: Ref, to: Ref): EdgeSpec => ({ type: "REFERENCES", from, to });

async function chain(names: string[]) {
  const repo = new InMemoryGraphRepository();
  await seed(repo, C, names.map(cls), names.slice(1).map((n, i) => ref(cls(names[i]), cls(n))));
  return { repo, service: new TraversalService(repo) };
}

async function hub(spokes: number, hops?: number) {
  const repo = new InMemoryGraphRepository();
  const center: Ref = ["CustomObject", "Hub__c"];
  const names = Array.from({ length: spokes }, (_, i) => `Spoke${String(i).padStart(5, "0")}`);
  await seed(repo, C, [center, ...names.map(cls)], names.map((n) => ref(cls(n), center)));
  return { repo, service: new TraversalService(repo), center, hops };
}

const ringOf = (result: { nodes: Array<{ nodeKey: string; ring: number }> }, ref: Ref) => result.nodes.find((n) => n.nodeKey === keyOfRef(ref))?.ring;

describe("TraversalService.expand", () => {
  it("returns the root and its direct neighbours by default, whichever way the edges point", async () => {
    const { service } = await chain(["A", "B", "C", "D"]);
    const result = (await service.expand(C, keyOfRef(cls("B"))))!;
    expect(result.hops).toBe(1);
    expect(ringOf(result, cls("B"))).toBe(0);
    expect(ringOf(result, cls("A"))).toBe(1); // A -> B points at the root
    expect(ringOf(result, cls("C"))).toBe(1); // B -> C points away from it
    expect(ringOf(result, cls("D"))).toBeUndefined();
    expect(result.edges).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it("reports the ring each node was found in", async () => {
    const { service } = await chain(["A", "B", "C", "D", "E"]);
    const result = (await service.expand(C, keyOfRef(cls("A")), { hops: 3 }))!;
    expect(["B", "C", "D", "E"].map((n) => ringOf(result, cls(n)))).toEqual([1, 2, 3, undefined]);
  });

  it("clamps hops to the maximum and to at least one", async () => {
    const { service } = await chain(["A", "B", "C", "D", "E", "F"]);
    expect((await service.expand(C, keyOfRef(cls("A")), { hops: 99 }))!.hops).toBe(MAX_HOPS);
    expect((await service.expand(C, keyOfRef(cls("A")), { hops: 0 }))!.hops).toBe(1);
  });

  it("includes a node reachable by two paths once, and every edge once", async () => {
    const repo = new InMemoryGraphRepository();
    const [a, b, c, d] = ["A", "B", "C", "D"].map(cls);
    await seed(repo, C, [a, b, c, d], [ref(a, b), ref(a, c), ref(b, d), ref(c, d)]);
    const result = (await new TraversalService(repo).expand(C, keyOfRef(a), { hops: 2 }))!;
    expect(result.nodes).toHaveLength(4);
    expect(new Set(nodeKeys(result.nodes)).size).toBe(4);
    expect(result.edges).toHaveLength(4);
  });

  it("returns null for an unknown node, a stale node and another connection's node", async () => {
    const { repo, service } = await chain(["A", "B"]);
    expect(await service.expand(C, keyOfRef(cls("Nope")))).toBeNull();
    expect(await service.expand("other", keyOfRef(cls("A")))).toBeNull();
    repo.nodes.get(`${C}\u0000${keyOfRef(cls("A"))}`)!.state = "stale";
    expect(await service.expand(C, keyOfRef(cls("A")))).toBeNull();
  });

  it("leaves out stale neighbours and stale edges", async () => {
    const repo = new InMemoryGraphRepository();
    const [a, b, c] = ["A", "B", "C"].map(cls);
    await seed(repo, C, [a, b, c], [ref(a, b), ref(a, c)]);
    repo.nodes.get(`${C}\u0000${keyOfRef(b)}`)!.state = "stale";
    repo.edges.get(`${C}\u0000${edgeRow(ref(a, c)).edgeKey}`)!.state = "stale";
    const result = (await new TraversalService(repo).expand(C, keyOfRef(a)))!;
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
  });

  it("never mixes in another connection's graph", async () => {
    const { repo, service } = await chain(["A", "B"]);
    await seed(repo, "c2", [cls("A"), cls("Z")], [ref(cls("A"), cls("Z"))]);
    const result = (await service.expand(C, keyOfRef(cls("A"))))!;
    expect(result.nodes.map((n) => n.nodeKey)).not.toContain(keyOfRef(cls("Z")));
  });

  it("answers a hub with keyset pages that together cover every neighbour exactly once", async () => {
    const { service, center } = await hub(1200);
    const seen: string[] = [];
    let edges = 0;
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = (await service.expand(C, keyOfRef(center), { limit: 500, cursor }))!;
      seen.push(...nodeKeys(page.nodes));
      edges += page.edges.length;
      expect(page.nodes.length).toBeLessThanOrEqual(501); // the first page also carries the root
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(1201);
    expect(new Set(seen).size).toBe(1201);
    expect(edges).toBe(1200);
  });

  it("pages through rings in order and sends only new nodes after the first page", async () => {
    const { service } = await chain(["A", "B", "C", "D", "E"]);
    const root = keyOfRef(cls("A"));
    const first = (await service.expand(C, root, { hops: 3, limit: 2 }))!;
    expect(first.nodes.map((n) => (n as RingNode).ring)).toEqual([0, 1, 2]);
    expect(first.nextCursor).not.toBeNull();
    const second = (await service.expand(C, root, { hops: 3, limit: 2, cursor: first.nextCursor! }))!;
    expect(second.nodes.map((n) => n.ring)).toEqual([3]);
    expect(second.nextCursor).toBeNull();
    // The edge joining the two pages travels with the page that brings its newer end.
    expect(second.edges).toHaveLength(1);
    expect(first.edges).toHaveLength(2);
  });

  it("caps a page at the node cap", async () => {
    const { service, center } = await hub(600);
    const page = (await service.expand(C, keyOfRef(center), { limit: 10_000 }))!;
    expect(page.nodes).toHaveLength(EXPAND_NODE_CAP + 1);
    expect(page.nextCursor).not.toBeNull();
  });

  it("rejects a cursor that is malformed or beyond the requested hops", async () => {
    const { service } = await chain(["A", "B"]);
    const root = keyOfRef(cls("A"));
    await expect(service.expand(C, root, { cursor: "garbage" })).rejects.toBeInstanceOf(GraphInputError);
    await expect(service.expand(C, root, { hops: 1, cursor: `2:${"a".repeat(64)}` })).rejects.toBeInstanceOf(GraphInputError);
  });

  it("returns an empty page when the cursor is past the end", async () => {
    const { service } = await chain(["A", "B"]);
    const page = (await service.expand(C, keyOfRef(cls("A")), { cursor: `1:${"f".repeat(64)}` }))!;
    expect(page.nodes).toHaveLength(0);
    expect(page.edges).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
  });

  it("sends only identity for nodes the client already holds at the same checksum", async () => {
    const { service } = await chain(["A", "B", "C"]);
    const b = nodeRow("ApexClass", "B");
    const result = (await service.expand(C, keyOfRef(cls("A")), { known: [b.checksum] }))!;
    expect(result.nodes.find((n) => n.nodeKey === b.nodeKey)).toEqual({ nodeKey: b.nodeKey, checksum: b.checksum, ring: 1, unchanged: true });
    expect((result.nodes.find((n) => n.nodeKey === keyOfRef(cls("A"))) as RingNode).label).toBe("A");
  });

  it("rejects an oversized known list", async () => {
    const { service } = await chain(["A", "B"]);
    const known = Array.from({ length: 201 }, (_, i) => String(i).padStart(64, "0"));
    await expect(service.expand(C, keyOfRef(cls("A")), { known })).rejects.toBeInstanceOf(GraphInputError);
  });

  it("flags a ring whose edges hit the read cap", async () => {
    const { service, center } = await hub(RING_EDGE_CAP + 50);
    expect((await service.expand(C, keyOfRef(center), { limit: 5 }))!.truncated).toBe(true);
    const small = await hub(5);
    expect((await small.service.expand(C, keyOfRef(small.center)))!.truncated).toBe(false);
  });

  it("stops reading deeper rings once the page is full", async () => {
    const { repo, service } = await hub(30);
    let reads = 0;
    const original = repo.edgesOf.bind(repo);
    repo.edgesOf = async (...args) => {
      reads++;
      return original(...args);
    };
    await service.expand(C, keyOfRef(["CustomObject", "Hub__c"]), { hops: 3, limit: 5 });
    expect(reads).toBe(1);
  });

  it("follows only the requested edge types, in every ring", async () => {
    const repo = new InMemoryGraphRepository();
    const inv: Ref = ["CustomObject", "Invoice__c"];
    const acct: Ref = ["CustomObject", "Account"];
    const field: Ref = ["CustomField", "Invoice__c.Account__c"];
    await seed(repo, C, [inv, acct, field, cls("Svc")], [
      { type: "HAS_FIELD", from: inv, to: field },
      { type: "LOOKUP_TO", from: field, to: acct },
      { type: "REFERENCES", from: cls("Svc"), to: inv },
    ]);
    const service = new TraversalService(repo);
    const typed = (await service.expand(C, keyOfRef(inv), { hops: 2, edgeTypes: [typeKeyOf("HAS_FIELD"), typeKeyOf("LOOKUP_TO")] }))!;
    expect(typed.nodes.map((n) => n.nodeKey).sort()).toEqual([keyOfRef(acct), keyOfRef(field), keyOfRef(inv)].sort());
    expect(typed.edges.map((e) => e.kind).sort()).toEqual(["HAS_FIELD", "LOOKUP_TO"]);
    const all = (await service.expand(C, keyOfRef(inv), { hops: 2 }))!;
    expect(all.nodes.map((n) => n.nodeKey)).toContain(keyOfRef(cls("Svc")));
    // An empty list means "no restriction", not "no edges".
    expect((await service.expand(C, keyOfRef(inv), { edgeTypes: [] }))!.nodes.length).toBeGreaterThan(1);
  });

  it("attaches presentation facts and confidence to nodes and edges", async () => {
    const repo = new InMemoryGraphRepository();
    const obj: Ref = ["CustomObject", "Invoice__c"];
    await seed(repo, C, [obj, cls("Svc")], [{ type: "REFERENCES", from: cls("Svc"), to: obj, confidence: "heuristic" }]);
    const result = (await new TraversalService(repo).expand(C, keyOfRef(obj)))!;
    expect(result.nodes.find((n) => n.nodeKey === keyOfRef(cls("Svc")))).toMatchObject({ kind: "ApexClass", kindLabel: "Apex Class", categories: ["code"] });
    expect(result.edges[0]).toMatchObject({ kind: "REFERENCES", style: "dotted", confidence: "heuristic", source: keyOfRef(cls("Svc")), target: keyOfRef(obj) });
  });
});
