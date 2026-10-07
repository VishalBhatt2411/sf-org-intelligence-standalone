import { describe, expect, it } from "vitest";
import { DEFAULT_GRAPH_SETTINGS, resolveGraphSettings } from "./settings";

describe("resolveGraphSettings", () => {
  it("returns defaults for null, undefined and non-object input", () => {
    for (const bad of [null, undefined, "x", 5, [1, 2]]) {
      expect(resolveGraphSettings(bad)).toEqual(DEFAULT_GRAPH_SETTINGS);
    }
  });

  it("does not mutate the shared defaults", () => {
    const out = resolveGraphSettings({ maxHopDepth: 1 });
    out.maxHopDepth = 99;
    expect(DEFAULT_GRAPH_SETTINGS.maxHopDepth).toBe(3);
  });

  it("accepts valid overrides", () => {
    const out = resolveGraphSettings({ maxHopDepth: 2, maxTraversalNodeCount: 100, scanManagedPackageObjects: true });
    expect(out.maxHopDepth).toBe(2);
    expect(out.maxTraversalNodeCount).toBe(100);
    expect(out.scanManagedPackageObjects).toBe(true);
  });

  it("clamps values above the hard ceilings and below the floors", () => {
    const out = resolveGraphSettings({ maxHopDepth: 50, maxTraversalNodeCount: 99999, maxImpactDepth: 0, maxImpactNodeCount: -5 });
    expect(out.maxHopDepth).toBe(3);
    expect(out.maxTraversalNodeCount).toBe(500);
    expect(out.maxImpactDepth).toBe(1);
    expect(out.maxImpactNodeCount).toBe(1);
  });

  it("truncates fractions and falls back on NaN, Infinity and wrong types", () => {
    const out = resolveGraphSettings({ maxHopDepth: 2.9, maxImpactDepth: NaN, maxTraversalNodeCount: Infinity, repositoryPageSize: "10" });
    expect(out.maxHopDepth).toBe(2);
    expect(out.maxImpactDepth).toBe(3);
    expect(out.maxTraversalNodeCount).toBe(500);
    expect(out.repositoryPageSize).toBe(200);
  });

  it("ignores non-boolean flags", () => {
    expect(resolveGraphSettings({ scanManagedPackageObjects: "yes" }).scanManagedPackageObjects).toBe(false);
  });

  it("never lets the default page size exceed the result cap", () => {
    const out = resolveGraphSettings({ defaultSearchPageSize: 100, maxSearchResults: 10 });
    expect(out.defaultSearchPageSize).toBe(10);
  });
});
