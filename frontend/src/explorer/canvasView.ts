import type { Bounds, Point, Positions } from "./layout";

// Pan/zoom and manual-placement maths for the Field canvas toolbar (port of native oiGraphCanvas): fit,
// centre on the selection, reset view, reset layout and node drag. Pure so it can be tested without a browser.

export type View = { x: number; y: number; k: number };
export const MIN_K = 0.15;
export const MAX_K = 2.5;
// Screen pixels a press must travel before it counts as a drag rather than a click.
export const DRAG_THRESHOLD = 4;

export const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));
export const zoomPercent = (k: number) => `${Math.round(k * 100)}%`;

export function fitView(bounds: Bounds, width: number, height: number): View {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const k = clampK(Math.min((width - 80) / w, (height - 80) / h, 1));
  return { k, x: width / 2 - ((bounds.minX + bounds.maxX) / 2) * k, y: height / 2 - ((bounds.minY + bounds.maxY) / 2) * k };
}

export function zoomAround(v: View, factor: number, cx: number, cy: number): View {
  const k = clampK(v.k * factor);
  return { k, x: cx - ((cx - v.x) / v.k) * k, y: cy - ((cy - v.y) / v.k) * k };
}

// Native "Center on selected node": pans so the point sits mid-pane, keeping the zoom.
export const centerOn = (v: View, p: Point, width: number, height: number): View => ({ ...v, x: width / 2 - p.x * v.k, y: height / 2 - p.y * v.k });

// Native "Reset view": 100% zoom with the centre node (layout origin) mid-pane.
export const resetView = (width: number, height: number): View => ({ k: 1, x: width / 2, y: height / 2 });

// Laid-out positions plus the user's manual drags. Offsets for nodes no longer drawn are ignored.
export function applyOffsets(positions: Positions, offsets: ReadonlyMap<string, Point>): Positions {
  if (offsets.size === 0) return positions;
  const out: Positions = new Map();
  for (const [key, p] of positions) {
    const o = offsets.get(key);
    out.set(key, o ? { x: p.x + o.x, y: p.y + o.y } : p);
  }
  return out;
}

// Adds a screen-space drag to a node's offset, converting pixels to canvas units at the current zoom.
export function dragOffset(offsets: ReadonlyMap<string, Point>, key: string, dxScreen: number, dyScreen: number, k: number): Map<string, Point> {
  const next = new Map(offsets);
  const o = next.get(key) ?? { x: 0, y: 0 };
  next.set(key, { x: o.x + dxScreen / k, y: o.y + dyScreen / k });
  return next;
}

export const passedThreshold = (dx: number, dy: number) => Math.hypot(dx, dy) >= DRAG_THRESHOLD;

// Native export: the live <svg> serialised as a standalone file. Adds the namespaces a browser drops from
// inline markup so the file opens on its own.
export function standaloneSvg(markup: string): string {
  let out = markup;
  if (!/^<svg[^>]*\sxmlns=/.test(out)) out = out.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (out.includes("xlink:") && !/^<svg[^>]*\sxmlns:xlink=/.test(out)) out = out.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${out}`;
}
