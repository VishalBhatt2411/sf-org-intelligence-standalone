import { describe, expect, it } from "vitest";
import { scoreSignals, severityOf, weightedShareScore } from "./scoring";
import type { Signal } from "./types";

const sig = (over: Partial<Signal> = {}): Signal => ({ key: "k", label: "Signal", weight: 90, magnitude: 1, ...over });

describe("severityOf", () => {
  it("uses half-open bands: 70 is good, 40 is warning", () => {
    expect(severityOf(70)).toBe("good");
    expect(severityOf(69.9)).toBe("warning");
    expect(severityOf(40)).toBe("warning");
    expect(severityOf(39.9)).toBe("critical");
    expect(severityOf(0)).toBe("critical");
    expect(severityOf(100)).toBe("good");
  });
});

describe("scoreSignals", () => {
  it("scores an empty list as healthy, with a plain explanation", () => {
    const r = scoreSignals([]);
    expect(r.health).toBe(100);
    expect(r.badness).toBe(0);
    expect(r.severity).toBe("good");
    expect(r.explanation).toBe("No signals evaluated — nothing detected.");
  });

  it("applies weight, magnitude (over the 1.5 cap), confidence and multipliers", () => {
    // 90 x (1/1.5) x 0.75 = 45
    expect(scoreSignals([sig({ confidence: 0.75 })]).badness).toBe(45);
    // magnitude 3 is capped at 1.5 => full weight
    expect(scoreSignals([sig({ magnitude: 3, weight: 40 })]).badness).toBe(40);
    // impact 0.4: 90 x 1 x 0.4 = 36
    expect(scoreSignals([sig({ magnitude: 1.5, impactMultiplier: 0.4 })]).badness).toBe(36);
  });

  it("halves a signal with a compensating control and says so", () => {
    const r = scoreSignals([sig({ magnitude: 1.5, label: "Broad grant", hasCompensatingControl: true })]);
    expect(r.badness).toBe(45);
    expect(r.explanation).toContain("halved by a recorded compensating control");
  });

  it("contributes nothing for zero, negative or non-finite magnitudes", () => {
    expect(scoreSignals([sig({ magnitude: 0 })]).badness).toBe(0);
    expect(scoreSignals([sig({ magnitude: -2 })]).badness).toBe(0);
    expect(scoreSignals([sig({ magnitude: Number.NaN })]).badness).toBe(0);
    expect(scoreSignals([sig({ magnitude: Infinity, weight: 10 })]).badness).toBe(0);
  });

  it("clamps confidence to 0..1", () => {
    expect(scoreSignals([sig({ magnitude: 1.5, confidence: 5 })]).badness).toBe(90);
    expect(scoreSignals([sig({ magnitude: 1.5, confidence: -1 })]).badness).toBe(0);
  });

  it("adds independent signals and clamps the total at 100", () => {
    const r = scoreSignals([sig({ key: "a", magnitude: 1.5 }), sig({ key: "b", magnitude: 1.5 })]);
    expect(r.badness).toBe(100);
    expect(r.health).toBe(0);
    expect(r.severity).toBe("critical");
  });

  it("combines a correlation group by its largest member and marks the rest", () => {
    const r = scoreSignals([
      sig({ key: "a", weight: 40, magnitude: 1.5, correlationGroup: "g" }),
      sig({ key: "b", weight: 30, magnitude: 1.5, correlationGroup: "g" }),
      sig({ key: "c", weight: 10, magnitude: 1.5 }),
    ]);
    expect(r.badness).toBe(50);
    expect(r.contributors.find((c) => c.key === "b")).toMatchObject({ wasCorrelatedOut: true, contribution: 0 });
    expect(r.contributors.find((c) => c.key === "a")?.wasCorrelatedOut).toBe(false);
  });

  it("rounds badness to one decimal, half up", () => {
    // 90 x (0.5/1.5) x 0.75 = 22.5 -> health 77.5
    const r = scoreSignals([sig({ magnitude: 0.5, confidence: 0.75 })]);
    expect(r.badness).toBe(22.5);
    expect(r.health).toBe(77.5);
    expect(scoreSignals([sig({ weight: 10, magnitude: 0.1 })]).badness).toBe(0.7);
  });

  it("names the two largest contributors in the explanation", () => {
    const r = scoreSignals([
      sig({ key: "a", label: "Alpha", weight: 60, magnitude: 1.5 }),
      sig({ key: "b", label: "Beta", weight: 30, magnitude: 1.5 }),
      sig({ key: "c", label: "Gamma", weight: 5, magnitude: 1.5 }),
    ]);
    expect(r.explanation).toBe("Severity Critical because: Alpha contributed 60 points; Beta contributed 30 points.");
  });

  it("explains a score with no contributing signal", () => {
    expect(scoreSignals([sig({ magnitude: 0 })]).explanation).toBe("Severity Good — no individual signal contributed meaningfully; see contributor detail.");
  });

  it("reports the contributor fields it scored with", () => {
    const [c] = scoreSignals([sig({ key: "x", label: "X", note: "n", magnitude: 1.2345, exposureMultiplier: 1.15 })]).contributors;
    expect(c).toMatchObject({ key: "x", label: "X", note: "n", magnitude: 1.23, exposureMultiplier: 1.15, impactMultiplier: 1, confidence: 1, wasCorrelatedOut: false });
  });
});

describe("weightedShareScore", () => {
  it("is null when there is nothing to score", () => {
    expect(weightedShareScore(0, [{ count: 0, weight: 50 }])).toBeNull();
  });
  it("subtracts each rule's weighted share and rounds", () => {
    // 100 - (2/10 x 55 + 1/10 x 45) = 84.5 -> 85
    expect(weightedShareScore(10, [{ count: 2, weight: 55 }, { count: 1, weight: 45 }])).toBe(85);
  });
  it("never goes below 0 or above 100", () => {
    expect(weightedShareScore(1, [{ count: 1, weight: 500 }])).toBe(0);
    expect(weightedShareScore(5, [{ count: 0, weight: 50 }])).toBe(100);
  });
});
