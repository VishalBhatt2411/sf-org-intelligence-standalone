import { describe, expect, it } from "vitest";
import { NODE_H, NODE_W, boundsOf, layoutLanes, layoutRadial, nearestInDirection, type LayoutEdge, type LayoutNode } from "./layout";

const n = (key: string, ring: number, sort = key): LayoutNode => ({ key, ring, sort });
const e = (source: string, target: string): LayoutEdge => ({ source, target });
const at = (r: ReturnType<typeof layoutLanes>, key: string) => r.positions.get(key)!;

describe("layoutLanes", () => {
  // Svc and Trg point at the object; the object points at Owner. Ctl points at Svc one hop further out.
  const nodes = [n("obj", 0), n("svc", 1), n("trg", 1), n("owner", 1), n("ctl", 2)];
  const edges = [e("svc", "obj"), e("trg", "obj"), e("obj", "owner"), e("ctl", "svc")];

  it("puts the root at the origin, incoming on the left and outgoing on the right", () => {
    const r = layoutLanes("obj", nodes, edges);
    expect(at(r, "obj")).toEqual({ x: 0, y: 0 });
    expect(at(r, "svc").x).toBeLessThan(0);
    expect(at(r, "trg").x).toBe(at(r, "svc").x);
    expect(at(r, "owner").x).toBeGreaterThan(0);
  });

  it("puts a deeper node one column further out on its branch's side", () => {
    const r = layoutLanes("obj", nodes, edges);
    expect(at(r, "ctl").x).toBeLessThan(at(r, "svc").x);
  });

  it("stacks a column vertically centred without overlap, ordered by sort key", () => {
    const r = layoutLanes("obj", nodes, edges);
    const [first, second] = [at(r, "svc"), at(r, "trg")];
    expect(first.y).toBeLessThan(second.y);
    expect(first.y + second.y).toBeCloseTo(0);
    expect(second.y - first.y).toBeGreaterThanOrEqual(NODE_H);
  });

  it("orders a deeper column by where its parents sit", () => {
    const wide = [n("obj", 0), n("a", 1, "a"), n("b", 1, "b"), n("zz", 2, "a-child"), n("yy", 2, "z-child")];
    const wideEdges = [e("a", "obj"), e("b", "obj"), e("zz", "b"), e("yy", "a")];
    const r = layoutLanes("obj", wide, wideEdges);
    // yy hangs off a (upper), zz off b (lower), even though zz sorts first by name.
    expect(at(r, "yy").y).toBeLessThan(at(r, "zz").y);
  });

  it("is deterministic regardless of input order", () => {
    const a = layoutLanes("obj", nodes, edges);
    const b = layoutLanes("obj", [...nodes].reverse(), [...edges].reverse());
    for (const { key } of nodes) expect(at(b, key)).toEqual(at(a, key));
  });

  it("forces everything to one side for an impact view", () => {
    const right = layoutLanes("obj", nodes, edges, "right");
    for (const { key } of nodes.filter((x) => x.key !== "obj")) expect(at(right, key).x).toBeGreaterThan(0);
    const left = layoutLanes("obj", nodes, edges, "left");
    for (const { key } of nodes.filter((x) => x.key !== "obj")) expect(at(left, key).x).toBeLessThan(0);
  });

  it("still places a node that no edge connects, and handles a missing root", () => {
    const r = layoutLanes("obj", [n("obj", 0), n("lost", 1)], []);
    expect(at(r, "lost").x).toBeGreaterThan(0);
    expect(layoutLanes("nope", nodes, edges).positions.size).toBe(0);
  });

  it("ignores self-loops and edges to nodes that are not shown", () => {
    const r = layoutLanes("obj", [n("obj", 0), n("a", 1)], [e("obj", "obj"), e("a", "ghost"), e("a", "obj")]);
    expect(r.positions.size).toBe(2);
    expect(at(r, "a").x).toBeLessThan(0);
  });

  it("handles a large column without overlapping rows", () => {
    const many = Array.from({ length: 300 }, (_, i) => n(`k${String(i).padStart(3, "0")}`, 1));
    const r = layoutLanes("obj", [n("obj", 0), ...many], many.map((m) => e(m.key, "obj")));
    const ys = many.map((m) => at(r, m.key).y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(NODE_H);
  });
});

describe("layoutRadial", () => {
  const nodes = [n("f", 0), n("a", 1), n("b", 1), n("c", 1), n("d", 1), n("deep", 2)];
  const edges = [e("a", "f"), e("b", "f"), e("c", "f"), e("d", "f"), e("deep", "a")];

  it("centres the root and puts each ring at one distance from it", () => {
    const r = layoutRadial("f", nodes, edges);
    expect(r.positions.get("f")).toEqual({ x: 0, y: 0 });
    const dist = (k: string) => Math.hypot(r.positions.get(k)!.x, r.positions.get(k)!.y);
    expect(dist("a")).toBeCloseTo(dist("b"));
    expect(dist("a")).toBeCloseTo(dist("d"));
    expect(dist("deep")).toBeGreaterThan(dist("a"));
  });

  it("spreads a ring evenly, starting at the top", () => {
    const r = layoutRadial("f", nodes, edges);
    const first = r.positions.get("a")!;
    expect(first.x).toBeCloseTo(0);
    expect(first.y).toBeLessThan(0);
    expect(r.positions.get("c")!.y).toBeGreaterThan(0);
  });

  it("widens the ring so a crowded ring's nodes keep their spacing", () => {
    const many = Array.from({ length: 80 }, (_, i) => n(`k${String(i).padStart(2, "0")}`, 1));
    const r = layoutRadial("f", [n("f", 0), ...many], many.map((m) => e(m.key, "f")));
    const pts = many.map((m) => r.positions.get(m.key)!);
    let nearest = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) nearest = Math.min(nearest, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
    expect(nearest).toBeGreaterThan(100);
  });

  it("is deterministic regardless of input order and tolerates a missing root", () => {
    const a = layoutRadial("f", nodes, edges);
    const b = layoutRadial("f", [...nodes].reverse(), [...edges].reverse());
    for (const { key } of nodes) expect(b.positions.get(key)).toEqual(a.positions.get(key));
    expect(layoutRadial("zzz", nodes, edges).positions.size).toBe(0);
  });
});

describe("boundsOf", () => {
  it("covers every card, including its width and height", () => {
    const r = layoutLanes("obj", [n("obj", 0), n("a", 1)], [e("obj", "a")]);
    const b = boundsOf(r.positions);
    expect(b.minX).toBe(-NODE_W / 2);
    expect(b.maxX).toBe(at(r, "a").x + NODE_W / 2);
    expect(b.maxY - b.minY).toBe(NODE_H);
  });

  it("is zero for no nodes", () => {
    expect(boundsOf(new Map())).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});

describe("nearestInDirection", () => {
  const positions = new Map([
    ["c", { x: 0, y: 0 }],
    ["r1", { x: 300, y: 0 }],
    ["r2", { x: 300, y: 120 }],
    ["far", { x: 900, y: 0 }],
    ["l", { x: -300, y: 20 }],
    ["u", { x: 10, y: -100 }],
    ["d", { x: 0, y: 100 }],
  ]);

  it("moves to the nearest node that way, preferring one straight ahead", () => {
    expect(nearestInDirection(positions, "c", "right")).toBe("r1");
    expect(nearestInDirection(positions, "c", "left")).toBe("l");
    expect(nearestInDirection(positions, "c", "up")).toBe("u");
    expect(nearestInDirection(positions, "c", "down")).toBe("d");
  });

  it("returns null when nothing lies that way or the start is unknown", () => {
    expect(nearestInDirection(positions, "far", "right")).toBeNull();
    expect(nearestInDirection(positions, "nope", "right")).toBeNull();
  });

  it("can walk between nodes in a column", () => {
    expect(nearestInDirection(positions, "r1", "down")).toBe("r2");
    expect(nearestInDirection(positions, "r2", "up")).toBe("r1");
  });
});
