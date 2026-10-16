import { describe, expect, it } from "vitest";
import { DEFAULT_FILTER, applyRelationshipFilter, isFilterActive, legendEntries, toggleDirection, toggleType, type RelationshipFilter } from "./relationshipFilter";
import { edge, ringNode } from "./testKit";

const LOOKUP = { kind: "LOOKUP_TO", typeKey: "SalesforceMetadata.LOOKUP_TO", style: "dashed" as const };
const HAS_FIELD = { kind: "HAS_FIELD", typeKey: "SalesforceMetadata.HAS_FIELD", style: "solid" as const };

// F is the centre: F -> P (parent, lookup), P -> GP (grandparent), O -> F (owner via HAS_FIELD), C -> O (grandchild).
const graph = {
  nodes: [ringNode("F", 0), ringNode("P", 1), ringNode("GP", 2), ringNode("O", 1), ringNode("C", 2)],
  edges: [edge("F", "P", LOOKUP), edge("P", "GP", LOOKUP), edge("O", "F", HAS_FIELD), edge("C", "O", LOOKUP)],
};
const keys = (g: { nodes: { nodeKey: string }[] }) => g.nodes.map((n) => n.nodeKey).sort();
const withFilter = (over: Partial<RelationshipFilter>): RelationshipFilter => ({ ...DEFAULT_FILTER, ...over });

describe("applyRelationshipFilter", () => {
  it("returns the graph untouched when no filter is on", () => {
    expect(applyRelationshipFilter(graph, "F", DEFAULT_FILTER)).toBe(graph);
  });

  it("keeps only parents (outgoing) when children are switched off", () => {
    const out = applyRelationshipFilter(graph, "F", withFilter({ direction: { parents: true, children: false } }));
    expect(keys(out)).toEqual(["F", "GP", "P"]);
    expect(out.edges.map((e) => e.edgeKey).sort()).toEqual(["F>P", "P>GP"]);
  });

  it("keeps only children (incoming) when parents are switched off", () => {
    expect(keys(applyRelationshipFilter(graph, "F", withFilter({ direction: { parents: false, children: true } })))).toEqual(["C", "F", "O"]);
  });

  it("hides grandparents and grandchildren with direct relationships only", () => {
    expect(keys(applyRelationshipFilter(graph, "F", withFilter({ directOnly: true })))).toEqual(["F", "O", "P"]);
  });

  it("hides an edge type and whatever was reachable only through it, but always keeps the centre", () => {
    const out = applyRelationshipFilter(graph, "F", withFilter({ hiddenTypes: new Set([HAS_FIELD.typeKey]) }));
    expect(keys(out)).toEqual(["F", "GP", "P"]);
    const none = applyRelationshipFilter(graph, "F", withFilter({ hiddenTypes: new Set([HAS_FIELD.typeKey, LOOKUP.typeKey]) }));
    expect(keys(none)).toEqual(["F"]);
    expect(none.edges).toEqual([]);
  });
});

describe("filter toggles", () => {
  it("refuses to switch both directions off", () => {
    const parentsOnly = toggleDirection({ parents: true, children: true }, "children");
    expect(parentsOnly).toEqual({ parents: true, children: false });
    expect(toggleDirection(parentsOnly, "parents")).toBe(parentsOnly);
  });

  it("toggles an edge type on and off and reports whether any filter is active", () => {
    const hidden = toggleType(new Set(), "T");
    expect(hidden.has("T")).toBe(true);
    expect(isFilterActive(withFilter({ hiddenTypes: hidden }))).toBe(true);
    expect(toggleType(hidden, "T").size).toBe(0);
    expect(isFilterActive(DEFAULT_FILTER)).toBe(false);
  });
});

describe("legendEntries", () => {
  it("lists each edge type on the canvas once with its count, most used first", () => {
    const entries = legendEntries(graph.edges);
    expect(entries.map((e) => [e.kind, e.count, e.style])).toEqual([
      ["LOOKUP_TO", 3, "dashed"],
      ["HAS_FIELD", 1, "solid"],
    ]);
    expect(entries[0].label).toBe("Lookup");
  });

  it("falls back to the edge's own role names for an unknown kind", () => {
    const [entry] = legendEntries([edge("A", "B", { kind: "NEW_KIND", typeKey: "X.NEW_KIND", sourceRole: "Uses", targetRole: "Used By" })]);
    expect(entry.label).toBe("Uses");
    expect(entry.description).toBe("Uses / Used By");
  });
});
