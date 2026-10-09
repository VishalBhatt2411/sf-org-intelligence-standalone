import { describe, expect, it } from "vitest";
import type { ExpandResponse, GraphEdge, GraphNode } from "./graphApi";
import { apiNameOf, countLabel, matchFields, ownFieldOptions } from "./fieldOptions";
import { HAS_FIELD_EDGE, LOOKUP_TO_EDGE } from "./objectRelationshipView";

const node = (nodeKey: string, label: string, fqn: string): GraphNode => ({
  nodeKey, typeKey: "SalesforceMetadata.CustomField", kind: "CustomField", kindLabel: "Field", categories: ["structure"], label, fqn, namespace: null, parentKey: null, checksum: "c", attributes: {},
});
const edge = (source: string, target: string, typeKey = HAS_FIELD_EDGE): GraphEdge => ({
  edgeKey: `${source}>${target}`, typeKey, kind: "HAS_FIELD", style: "solid", sourceRole: "", targetRole: "", source, target, confidence: "exact", viaField: null, attributes: {},
});
const response = (nodes: GraphNode[], edges: GraphEdge[]): Pick<ExpandResponse, "nodes" | "edges"> => ({ nodes: nodes.map((n) => ({ ...n, ring: 1 })), edges });

describe("ownFieldOptions", () => {
  it("keeps only HAS_FIELD targets that start at the object, sorted by label", () => {
    const res = response(
      [node("f2", "Owner", "Account.OwnerId"), node("f1", "Account Parent", "Account.ParentId"), node("f3", "Other", "Contact.AccountId")],
      [edge("obj", "f2"), edge("obj", "f1"), edge("other", "f3"), edge("obj", "f3", LOOKUP_TO_EDGE)],
    );
    expect(ownFieldOptions("obj", res).map((o) => o.nodeKey)).toEqual(["f1", "f2"]);
  });

  it("de-duplicates repeated edges and ignores unchanged nodes", () => {
    const res = { nodes: [{ ...node("f1", "A", "X.A"), ring: 1 }, { nodeKey: "f9", checksum: "c", ring: 1, unchanged: true as const }], edges: [edge("obj", "f1"), edge("obj", "f1"), edge("obj", "f9")] };
    expect(ownFieldOptions("obj", res)).toHaveLength(1);
  });

  it("returns nothing for an object without fields", () => {
    expect(ownFieldOptions("obj", response([], []))).toEqual([]);
  });
});

describe("apiNameOf", () => {
  it("drops the object prefix", () => {
    expect(apiNameOf(node("f", "L", "Account.OwnerId"))).toBe("OwnerId");
    expect(apiNameOf(node("f", "L", "Loose"))).toBe("Loose");
  });
});

describe("matchFields", () => {
  const options = Array.from({ length: 20 }, (_, i) => {
    const n = node(`f${i}`, `Field ${i}`, `Obj.Api_${i}__c`);
    return { nodeKey: n.nodeKey, label: n.label, apiName: apiNameOf(n), node: n };
  });

  it("caps the visible rows but reports the whole count", () => {
    const m = matchFields(options, "");
    expect(m.rows).toHaveLength(12);
    expect(countLabel(m)).toBe("20 fields");
  });

  it("matches on label or API name, case-insensitively", () => {
    expect(matchFields(options, "api_1").total).toBe(11);
    expect(matchFields(options, "FIELD 7").rows.map((o) => o.nodeKey)).toEqual(["f7"]);
    expect(countLabel(matchFields(options, "field 7"))).toBe("1 match");
    expect(countLabel(matchFields(options, "zzz"))).toBe("0 matches");
  });
});
