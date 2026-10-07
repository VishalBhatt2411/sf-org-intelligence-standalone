import { describe, expect, it } from "vitest";
import {
  ALL_EDGE_TYPE_KEYS,
  EDGE_KINDS,
  IMPACT_EDGE_TYPE_KEYS,
  NODE_KINDS,
  edgeKindInfo,
  edgeTypeKey,
  isEdgeKind,
  isNodeKind,
  nodeKindInfo,
  nodeTypeKey,
} from "./nodeTypes";

describe("node and edge registry", () => {
  it("has every edge confidence in the allowed set and non-empty roles", () => {
    for (const info of Object.values(EDGE_KINDS)) {
      expect(["exact", "parsed", "heuristic"]).toContain(info.defaultConfidence);
      expect(info.sourceRole).not.toBe("");
      expect(info.targetRole).not.toBe("");
    }
  });

  it("gives every node kind a label and at least one category", () => {
    for (const info of Object.values(NODE_KINDS)) {
      expect(info.label).not.toBe("");
      expect(info.categories.length).toBeGreaterThan(0);
    }
  });

  it("round-trips kinds through type keys", () => {
    expect(nodeKindInfo(nodeTypeKey("ApexClass"))?.kind).toBe("ApexClass");
    expect(edgeKindInfo(edgeTypeKey("REFERENCES"))?.kind).toBe("REFERENCES");
  });

  it("returns null for unknown kinds and rejects inherited property names", () => {
    expect(nodeKindInfo("SalesforceMetadata.Nope")).toBeNull();
    expect(edgeKindInfo("SalesforceMetadata.Nope")).toBeNull();
    expect(isNodeKind("toString")).toBe(false);
    expect(isEdgeKind("constructor")).toBe(false);
  });
});

describe("impact edges", () => {
  it("are exactly REFERENCES, EXECUTES_ON, GRANTS_ACCESS_TO and DEPENDS_ON", () => {
    expect([...IMPACT_EDGE_TYPE_KEYS].sort()).toEqual(
      ["REFERENCES", "EXECUTES_ON", "GRANTS_ACCESS_TO", "DEPENDS_ON"].map((k) => edgeTypeKey(k as keyof typeof EDGE_KINDS)).sort()
    );
  });

  it("are a subset of all edge type keys", () => {
    for (const k of IMPACT_EDGE_TYPE_KEYS) expect(ALL_EDGE_TYPE_KEYS).toContain(k);
  });
});
