import { describe, expect, it } from "vitest";
import type { ObjectConnector } from "./objectRelationshipView";
import { buildElbowPath, computeDiagram, connectorLabelText, type DiagramInput } from "./relationshipLayout";

const connector = (key: string, direction: ObjectConnector["direction"], fieldNames: string[], type: "Lookup" | "MasterDetail" = "Lookup"): ObjectConnector => ({
  connectorKey: `${direction}::${key}`,
  counterpartObject: { nodeKey: key, label: key, fqn: key, isCustom: false },
  direction,
  fields: fieldNames.map((f) => ({ fieldNodeKey: `${key}.${f}`, fieldFqn: `${key}.${f}`, fieldApiName: f, relationshipType: type, isSystemRelationship: false })),
  relationshipCount: fieldNames.length,
  primaryRelationshipType: type,
  isSystemRelationship: false,
});

const many = (n: number, direction: "incoming" | "outgoing") => Array.from({ length: n }, (_, i) => connector(`O${i}`, direction, ["AccountId"]));
const input = (over: Partial<DiagramInput> = {}): DiagramInput => ({ incoming: [], outgoing: [], self: [], showAllIncoming: false, showAllOutgoing: false, selectedConnectorKey: null, ...over });

describe("connectorLabelText", () => {
  it("names the field for a single relationship and counts several", () => {
    expect(connectorLabelText(connector("A", "incoming", ["AccountId"]))).toBe("AccountId · Lookup");
    expect(connectorLabelText(connector("A", "incoming", ["X", "Y", "Z"]))).toBe("3 Lookup Relationships");
    expect(connectorLabelText(connector("A", "outgoing", ["X"], "MasterDetail"))).toBe("X · Master-Detail");
  });
});

describe("buildElbowPath", () => {
  it("is a straight line when start and end share a row", () => {
    expect(buildElbowPath(0, 50, 40, 100, 50)).toBe("M 0 50 H 100");
  });
  it("rounds both turns and keeps the vertical run on the trunk", () => {
    const d = buildElbowPath(0, 0, 50, 100, 100, 10);
    expect(d).toContain("Q 50 0 50 10");
    expect(d).toContain("V 90");
  });
  it("clamps the radius so a short run cannot overshoot", () => {
    expect(buildElbowPath(0, 0, 50, 100, 8, 14)).toContain("Q 50 0 50 4");
  });
});

describe("computeDiagram", () => {
  it("bounds each lane to six and offers a show-more tile for the rest", () => {
    const d = computeDiagram(input({ incoming: many(9, "incoming"), outgoing: many(2, "outgoing") }));
    expect(d.incoming).toHaveLength(6);
    expect(d.incomingShowMore?.label).toBe("+ Show 3 more");
    expect(d.outgoingShowMore).toBeNull();
  });
  it("shows everything once the lane is expanded", () => {
    const d = computeDiagram(input({ incoming: many(9, "incoming"), showAllIncoming: true }));
    expect(d.incoming).toHaveLength(9);
    expect(d.incomingShowMore).toBeNull();
  });
  it("puts incoming on the left, the centre in the middle and outgoing on the right", () => {
    const d = computeDiagram(input({ incoming: many(1, "incoming"), outgoing: many(1, "outgoing") }));
    expect(d.incoming[0].x).toBeLessThan(d.centerBox.x);
    expect(d.outgoing[0].x).toBeGreaterThan(d.centerBox.x + d.centerBox.width);
  });
  it("is deterministic and never reflows on selection", () => {
    const base = input({ incoming: many(3, "incoming"), outgoing: many(3, "outgoing") });
    const a = computeDiagram(base);
    const b = computeDiagram({ ...base, selectedConnectorKey: base.incoming[1].connectorKey });
    expect(b.incoming.map((e) => e.y)).toEqual(a.incoming.map((e) => e.y));
    expect(b.canvasHeight).toBe(a.canvasHeight);
    expect(a.explore).toBeNull();
    expect(b.explore?.nodeKey).toBe("O1");
  });
  it("keeps the explore button clear of the next row", () => {
    const base = input({ incoming: many(2, "incoming"), selectedConnectorKey: "incoming::O0" });
    const d = computeDiagram(base);
    const gap = d.incoming[1].y - (d.explore!.y + d.explore!.height);
    expect(gap).toBeGreaterThanOrEqual(0);
  });
  it("grows the canvas below the centre for self-relationships", () => {
    const without = computeDiagram(input());
    const withSelf = computeDiagram(input({ self: [connector("Self", "self", ["ParentId"])] }));
    expect(withSelf.canvasHeight).toBeGreaterThan(without.canvasHeight);
    expect(withSelf.self[0].cardY).toBeGreaterThan(without.centerBox.y + without.centerBox.height);
  });
  it("handles an empty centre", () => {
    const d = computeDiagram(input());
    expect(d.incoming).toEqual([]);
    expect(d.canvasWidth).toBeGreaterThan(0);
  });
});
