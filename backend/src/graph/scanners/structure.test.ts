import { describe, expect, it } from "vitest";
import { keyOf } from "../draft";
import { ObjectIndex } from "../objectIndex";
import type { DescribedField } from "./inputs";
import { scanObjects, scanRelationshipFields } from "./structure";

const index = new ObjectIndex([{ name: "Account" }, { name: "Invoice__c" }, { name: "User" }]);

const field = (over: Partial<DescribedField> & { name: string }): DescribedField => ({
  label: over.name,
  type: "reference",
  referenceTo: ["Account"],
  masterDetail: false,
  sfId: null,
  ...over,
});

describe("scanObjects", () => {
  it("emits one node per object and maps Ids to node keys", () => {
    const out = scanObjects([
      { apiName: "Account", label: "Account", sfId: null },
      { apiName: "Invoice__c", label: "Invoice", sfId: "01I000000000001AAA" },
    ]);
    expect(out.nodes.map((n) => n.fqn)).toEqual(["Account", "Invoice__c"]);
    expect(out.nodes[1].attributes).toEqual({ label: "Invoice", custom: true });
    expect(out.nodes[0].attributes).toMatchObject({ custom: false });
    expect(out.ids).toEqual([["01I000000000001AAA", keyOf("CustomObject", "Invoice__c")]]);
    expect(out.edges).toEqual([]);
  });

  it("falls back to the API name when the label is blank, and handles no input", () => {
    expect(scanObjects([{ apiName: "X__c", label: "", sfId: null }]).nodes[0].label).toBe("X__c");
    expect(scanObjects([]).nodes).toEqual([]);
  });

  it("derives the namespace from a namespaced custom object", () => {
    expect(scanObjects([{ apiName: "pkg__Thing__c", label: "T", sfId: null }]).nodes[0].namespace).toBe("pkg");
  });
});

describe("scanRelationshipFields", () => {
  it("emits the field node, HAS_FIELD and LOOKUP_TO for a lookup", () => {
    const out = scanRelationshipFields([{ name: "Invoice__c", fields: [field({ name: "Account__c", label: "Account", sfId: "00N000000000001AAA" })] }], index);
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0]).toMatchObject({
      fqn: "Invoice__c.Account__c",
      parentKey: keyOf("CustomObject", "Invoice__c"),
      attributes: { relationship: "Lookup", referenceTo: ["Account"] },
    });
    expect(out.edges.map((e) => [e.typeKey, e.confidence])).toEqual([
      ["SalesforceMetadata.HAS_FIELD", "exact"],
      ["SalesforceMetadata.LOOKUP_TO", "exact"],
    ]);
    expect(out.edges[1].targetNodeKey).toBe(keyOf("CustomObject", "Account"));
    expect(out.ids).toEqual([["00N000000000001AAA", out.edges[0].targetNodeKey]]);
  });

  it("uses MASTER_DETAIL_TO for a master-detail field", () => {
    const out = scanRelationshipFields([{ name: "Invoice__c", fields: [field({ name: "Parent__c", masterDetail: true })] }], index);
    expect(out.edges[1].typeKey).toBe("SalesforceMetadata.MASTER_DETAIL_TO");
    expect(out.nodes[0].attributes).toMatchObject({ relationship: "MasterDetail" });
  });

  it("emits one edge per in-scope target of a polymorphic field and drops out-of-scope targets", () => {
    const out = scanRelationshipFields([{ name: "Invoice__c", fields: [field({ name: "Who__c", referenceTo: ["Account", "Group", "User"] })] }], index);
    const lookups = out.edges.filter((e) => e.typeKey.endsWith("LOOKUP_TO"));
    expect(lookups).toHaveLength(2);
    expect(out.nodes[0].attributes.referenceTo).toEqual(["Account", "User"]);
  });

  it("skips a field whose targets are all out of scope", () => {
    const out = scanRelationshipFields([{ name: "Invoice__c", fields: [field({ name: "Grp__c", referenceTo: ["Group"] })] }], index);
    expect(out).toEqual({ nodes: [], edges: [], ids: [] });
  });

  it("skips system and non-reference fields", () => {
    const out = scanRelationshipFields(
      [
        {
          name: "Invoice__c",
          fields: [
            field({ name: "OwnerId", referenceTo: ["User"] }),
            field({ name: "CreatedById", referenceTo: ["User"] }),
            field({ name: "Name", type: "string", referenceTo: null }),
          ],
        },
      ],
      index
    );
    expect(out.nodes).toEqual([]);
  });

  it("skips a described object that is not in scope", () => {
    expect(scanRelationshipFields([{ name: "Other__c", fields: [field({ name: "A__c" })] }], index).nodes).toEqual([]);
  });

  it("resolves object and target names case-insensitively to canonical names", () => {
    const out = scanRelationshipFields([{ name: "invoice__c", fields: [field({ name: "A__c", referenceTo: ["account"] })] }], index);
    expect(out.nodes[0].fqn).toBe("Invoice__c.A__c");
    expect(out.edges[1].targetNodeKey).toBe(keyOf("CustomObject", "Account"));
  });

  it("scales to many objects and fields", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      name: "Invoice__c",
      fields: Array.from({ length: 40 }, (_, j) => field({ name: `F${i}_${j}__c` })),
    }));
    const out = scanRelationshipFields(many, index);
    expect(out.nodes).toHaveLength(2000);
    expect(out.edges).toHaveLength(4000);
  });
});
