// Pure layout functions for the Explorer canvas. No layout library: both layouts are deterministic, so
// the same graph always lands in the same place and a re-render never makes the picture jump.
//
//  - Lane layout (object mode): the focus node sits in the middle, what points at it fans out to the
//    left and what it points at fans out to the right, one column per hop. Reads as "who uses this /
//    what does this use".
//  - Radial layout (field mode): the focus node sits at the centre and each hop is a ring around it.
//
// Positions are node centres in canvas units.

export const NODE_W = 210;
export const NODE_H = 46;
const COL_GAP = 130;
const ROW_GAP = 16;
const RING_GAP = 300;
const ARC = 150;

export type LayoutNode = { key: string; ring: number; sort: string };
export type LayoutEdge = { source: string; target: string };
export type Point = { x: number; y: number };
export type Positions = Map<string, Point>;
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type LayoutResult = { positions: Positions; bounds: Bounds };
export type LaneSide = "left" | "right";

export function boundsOf(positions: Positions): Bounds {
  if (positions.size === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of positions.values()) {
    minX = Math.min(minX, x - NODE_W / 2);
    maxX = Math.max(maxX, x + NODE_W / 2);
    minY = Math.min(minY, y - NODE_H / 2);
    maxY = Math.max(maxY, y + NODE_H / 2);
  }
  return { minX, minY, maxX, maxY };
}

const bySort = (byKey: ReadonlyMap<string, LayoutNode>) => (a: string, b: string) =>
  byKey.get(a)!.sort < byKey.get(b)!.sort ? -1 : byKey.get(a)!.sort > byKey.get(b)!.sort ? 1 : a < b ? -1 : a > b ? 1 : 0;

// Breadth-first over the undirected graph from the root. Returns each reached node's parent and, for
// the root's direct neighbours, which way the connecting edge points.
function discover(rootKey: string, byKey: ReadonlyMap<string, LayoutNode>, edges: readonly LayoutEdge[]) {
  const adjacent = new Map<string, Array<{ other: string; incoming: boolean }>>();
  const add = (from: string, other: string, incoming: boolean) => {
    if (!adjacent.has(from)) adjacent.set(from, []);
    adjacent.get(from)!.push({ other, incoming });
  };
  for (const e of edges) {
    if (e.source === e.target || !byKey.has(e.source) || !byKey.has(e.target)) continue;
    add(e.source, e.target, false);
    add(e.target, e.source, true);
  }
  const compare = bySort(byKey);
  for (const list of adjacent.values()) list.sort((a, b) => compare(a.other, b.other) || Number(a.incoming) - Number(b.incoming));

  const parent = new Map<string, string>();
  const side = new Map<string, -1 | 1>();
  const order = [rootKey];
  const seen = new Set([rootKey]);
  for (let i = 0; i < order.length; i++) {
    const current = order[i];
    for (const { other, incoming } of adjacent.get(current) ?? []) {
      if (seen.has(other)) continue;
      seen.add(other);
      parent.set(other, current);
      // Pointing at the root puts a node on the left; anything deeper follows the branch it hangs from.
      side.set(other, current === rootKey ? (incoming ? -1 : 1) : side.get(current)!);
      order.push(other);
    }
  }
  return { parent, side, reached: seen };
}

export function layoutLanes(rootKey: string, nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], force?: LaneSide): LayoutResult {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const positions: Positions = new Map();
  if (!byKey.has(rootKey)) return { positions, bounds: boundsOf(positions) };
  const { parent, side } = discover(rootKey, byKey, edges);
  const forced = force ? (force === "left" ? -1 : 1) : null;

  const columns = new Map<number, string[]>();
  for (const n of nodes) {
    if (n.key === rootKey) continue;
    const s = forced ?? side.get(n.key) ?? 1;
    const col = s * Math.max(1, n.ring);
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col)!.push(n.key);
  }

  const compare = bySort(byKey);
  const rowH = NODE_H + ROW_GAP;
  const colW = NODE_W + COL_GAP;
  positions.set(rootKey, { x: 0, y: 0 });
  // Inner columns first, so a deeper column can order its nodes by where their parents ended up.
  const order = [...columns.keys()].sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
  for (const col of order) {
    const keys = columns.get(col)!;
    const anchor = (k: string) => positions.get(parent.get(k) ?? rootKey)?.y ?? 0;
    keys.sort((a, b) => (Math.abs(col) > 1 ? anchor(a) - anchor(b) : 0) || compare(a, b));
    keys.forEach((k, i) => positions.set(k, { x: col * colW, y: (i - (keys.length - 1) / 2) * rowH }));
  }
  return { positions, bounds: boundsOf(positions) };
}

export function layoutRadial(rootKey: string, nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): LayoutResult {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const positions: Positions = new Map();
  if (!byKey.has(rootKey)) return { positions, bounds: boundsOf(positions) };
  const { parent } = discover(rootKey, byKey, edges);

  const rings = new Map<number, string[]>();
  for (const n of nodes) {
    if (n.key === rootKey) continue;
    const ring = Math.max(1, n.ring);
    if (!rings.has(ring)) rings.set(ring, []);
    rings.get(ring)!.push(n.key);
  }

  const compare = bySort(byKey);
  const angles = new Map<string, number>();
  positions.set(rootKey, { x: 0, y: 0 });
  let previousRadius = 0;
  for (const ring of [...rings.keys()].sort((a, b) => a - b)) {
    const keys = rings.get(ring)!;
    const parentAngle = (k: string) => angles.get(parent.get(k) ?? rootKey) ?? 0;
    keys.sort((a, b) => (ring > 1 ? parentAngle(a) - parentAngle(b) : 0) || compare(a, b));
    const radius = Math.max(ring * RING_GAP, previousRadius + RING_GAP * 0.6, (keys.length * ARC) / (2 * Math.PI));
    previousRadius = radius;
    keys.forEach((k, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / keys.length;
      angles.set(k, angle);
      positions.set(k, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
  }
  return { positions, bounds: boundsOf(positions) };
}

export type Direction = "up" | "down" | "left" | "right";

// Keyboard navigation: the nearest node in the pressed direction, preferring ones that sit straight
// that way over ones far off to the side. Null when nothing lies in that direction.
export function nearestInDirection(positions: Positions, from: string, direction: Direction): string | null {
  const origin = positions.get(from);
  if (!origin) return null;
  const forward = direction === "right" || direction === "down" ? 1 : -1;
  const horizontal = direction === "left" || direction === "right";
  let best: string | null = null;
  let bestScore = Infinity;
  for (const [key, p] of positions) {
    if (key === from) continue;
    const along = ((horizontal ? p.x - origin.x : p.y - origin.y)) * forward;
    const across = Math.abs(horizontal ? p.y - origin.y : p.x - origin.x);
    if (along <= 0.5 || across > along * 2.5 + NODE_H) continue;
    const score = along + across * 2;
    if (score < bestScore || (score === bestScore && best !== null && key < best)) {
      best = key;
      bestScore = score;
    }
  }
  return best;
}
