import { describe, expect, it } from "vitest";
import { MAX_K, MIN_K, applyOffsets, centerOn, dragOffset, fitView, passedThreshold, resetView, standaloneSvg, zoomAround, zoomPercent } from "./canvasView";

describe("canvasView", () => {
  it("fits bounds into the pane without zooming past 100%", () => {
    const v = fitView({ minX: -100, minY: -50, maxX: 100, maxY: 50 }, 800, 600);
    expect(v.k).toBe(1);
    expect(v).toEqual({ k: 1, x: 400, y: 300 });
    expect(fitView({ minX: 0, minY: 0, maxX: 100000, maxY: 10 }, 800, 600).k).toBe(MIN_K);
  });

  it("zooms around a point, clamped, keeping that point still", () => {
    const v = zoomAround({ x: 0, y: 0, k: 1 }, 2, 100, 100);
    expect(v).toEqual({ k: 2, x: -100, y: -100 });
    expect(zoomAround({ x: 0, y: 0, k: 2 }, 10, 0, 0).k).toBe(MAX_K);
    expect(zoomPercent(1.234)).toBe("123%");
  });

  it("centres on a node keeping the zoom, and resets to 100% on the centre", () => {
    expect(centerOn({ x: 5, y: 5, k: 0.5 }, { x: 200, y: -100 }, 800, 600)).toEqual({ k: 0.5, x: 300, y: 350 });
    expect(resetView(800, 600)).toEqual({ k: 1, x: 400, y: 300 });
  });

  it("applies manual drag offsets in canvas units and ignores ones for nodes no longer drawn", () => {
    const positions = new Map([["A", { x: 0, y: 0 }], ["B", { x: 10, y: 10 }]]);
    let offsets = dragOffset(new Map(), "A", 20, -10, 2);
    offsets = dragOffset(offsets, "A", 20, 0, 2);
    offsets = dragOffset(offsets, "Gone", 5, 5, 1);
    const out = applyOffsets(positions, offsets);
    expect(out.get("A")).toEqual({ x: 20, y: -5 });
    expect(out.get("B")).toEqual({ x: 10, y: 10 });
    expect(out.has("Gone")).toBe(false);
    expect(applyOffsets(positions, new Map())).toBe(positions);
  });

  it("treats small movements as a click", () => {
    expect(passedThreshold(2, 2)).toBe(false);
    expect(passedThreshold(3, 3)).toBe(true);
  });

  it("makes exported markup a standalone SVG file", () => {
    const out = standaloneSvg('<svg width="10"><use xlink:href="#a"/></svg>');
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg')).toBe(true);
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(standaloneSvg('<svg xmlns="http://www.w3.org/2000/svg"></svg>').match(/xmlns=/g)).toHaveLength(1);
  });
});
