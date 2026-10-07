import { describe, expect, it } from "vitest";
import { dedupeEdges, edgeDraft, keyOf, lastSegment, nodeDraft, nodeNamespace } from "./draft";
import { nodeKeyFor } from "./keys";

describe("nodeDraft", () => {
  it("derives the key from kind, namespace and fqn", () => {
    const { key, draft } = nodeDraft("ApexClass", { fqn: "Billing", label: "Billing" });
    expect(key).toBe(nodeKeyFor("ApexClass", null, "Billing"));
    expect(draft).toMatchObject({ typeKey: "SalesforceMetadata.ApexClass", namespace: null, parentKey: null, attributes: {} });
  });

  it("takes the namespace from the last dotted segment of the fqn", () => {
    const { draft } = nodeDraft("CustomField", { fqn: "Account.ns__Thing__c", label: "Thing" });
    expect(draft.namespace).toBe("ns");
    expect(lastSegment("Account.ns__Thing__c")).toBe("ns__Thing__c");
    expect(lastSegment("Plain")).toBe("Plain");
  });

  it("lets an explicit namespace, including null, override the derived one", () => {
    expect(nodeNamespace("Account.ns__Thing__c", null)).toBeNull();
    expect(nodeNamespace("Account.Thing__c", "x")).toBe("x");
    expect(keyOf("CustomObject", "Account")).toBe(nodeKeyFor("CustomObject", null, "Account"));
  });
});

describe("edgeDraft", () => {
  it("uses the registry default confidence unless overridden", () => {
    expect(edgeDraft("HAS_FIELD", "a", "b").confidence).toBe("exact");
    expect(edgeDraft("REFERENCES", "a", "b").confidence).toBe("heuristic");
    expect(edgeDraft("EXECUTES_ON", "a", "b", { confidence: "parsed", attributes: { e: 1 } })).toMatchObject({
      confidence: "parsed",
      attributes: { e: 1 },
    });
  });
});

describe("dedupeEdges", () => {
  it("keeps the first of identical (source, type, target) edges", () => {
    const first = edgeDraft("REFERENCES", "a", "b", { attributes: { n: 1 } });
    const out = dedupeEdges([first, edgeDraft("REFERENCES", "a", "b", { attributes: { n: 2 } }), edgeDraft("DEPENDS_ON", "a", "b"), edgeDraft("REFERENCES", "b", "a")]);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(first);
  });

  it("handles an empty list", () => {
    expect(dedupeEdges([])).toEqual([]);
  });
});
