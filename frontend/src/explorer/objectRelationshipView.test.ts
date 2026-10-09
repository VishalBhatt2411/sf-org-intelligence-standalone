import { describe, expect, it } from "vitest";
import { edge, node } from "./testKit";
import {
  DEFAULT_VISIBLE_PER_LANE,
  FIELD_TYPE_KEY,
  HAS_FIELD_EDGE,
  LOOKUP_TO_EDGE,
  MASTER_DETAIL_TO_EDGE,
  OBJECT_TYPE_KEY,
  buildObjectRelationshipView,
  filterByVisibility,
} from "./objectRelationshipView";

const obj = (name: string, custom?: boolean) => node(name, { typeKey: OBJECT_TYPE_KEY, kind: "CustomObject", label: name, fqn: name, attributes: custom === undefined ? {} : { custom } });
const field = (owner: string, name: string) => node(`${owner}.${name}`, { typeKey: FIELD_TYPE_KEY, kind: "CustomField", label: name, fqn: `${owner}.${name}`, parentKey: owner });
const hasField = (owner: string, name: string) => edge(owner, `${owner}.${name}`, { typeKey: HAS_FIELD_EDGE });
const lookup = (owner: string, name: string, target: string) => edge(`${owner}.${name}`, target, { typeKey: LOOKUP_TO_EDGE, edgeKey: `${owner}.${name}>${target}` });
const master = (owner: string, name: string, target: string) => edge(`${owner}.${name}`, target, { typeKey: MASTER_DETAIL_TO_EDGE, edgeKey: `${owner}.${name}>${target}` });

describe("buildObjectRelationshipView", () => {
  const nodes = [obj("Account", false), obj("Invoice__c", true), obj("Project__c"), field("Invoice__c", "Account__c"), field("Invoice__c", "OwnerId"), field("Account", "ParentId"), field("Account", "Owner_Project__c"), field("Project__c", "Invoice__c")];
  const edges = [
    hasField("Invoice__c", "Account__c"), hasField("Invoice__c", "OwnerId"), hasField("Account", "ParentId"), hasField("Account", "Owner_Project__c"), hasField("Project__c", "Invoice__c"),
    master("Invoice__c", "Account__c", "Account"),
    lookup("Invoice__c", "OwnerId", "Account"),
    lookup("Account", "ParentId", "Account"),
    lookup("Account", "Owner_Project__c", "Project__c"),
    lookup("Project__c", "Invoice__c", "Invoice__c"),
  ];

  it("classifies incoming, outgoing and self relationships around the centre", () => {
    const v = buildObjectRelationshipView(nodes, edges, "Account");
    expect(v.rootObject?.nodeKey).toBe("Account");
    expect(v.incomingRelationships.map((c) => c.counterpartObject.nodeKey)).toEqual(["Invoice__c"]);
    expect(v.outgoingRelationships.map((c) => c.counterpartObject.nodeKey)).toEqual(["Project__c"]);
    expect(v.selfRelationships.map((c) => c.counterpartObject.nodeKey)).toEqual(["Account"]);
    expect(v.counts).toEqual({ incomingTotal: 1, outgoingTotal: 1, selfTotal: 1 });
  });

  it("groups several fields between one pair into a single connector", () => {
    const [c] = buildObjectRelationshipView(nodes, edges, "Account").incomingRelationships;
    expect(c.relationshipCount).toBe(2);
    expect(c.fields.map((f) => f.fieldApiName)).toEqual(["Account__c", "OwnerId"]);
    expect(c.primaryRelationshipType).toBe("MasterDetail");
    // One business field keeps the connector out of the system bucket.
    expect(c.isSystemRelationship).toBe(false);
  });

  it("flags a connector made only of audit fields as system", () => {
    const v = buildObjectRelationshipView(
      [obj("Account"), obj("Invoice__c"), field("Invoice__c", "OwnerId")],
      [hasField("Invoice__c", "OwnerId"), lookup("Invoice__c", "OwnerId", "Account")],
      "Account",
    );
    expect(v.incomingRelationships[0].isSystemRelationship).toBe(true);
    expect(filterByVisibility(v.incomingRelationships, "business")).toHaveLength(0);
    expect(filterByVisibility(v.incomingRelationships, "system")).toHaveLength(1);
    expect(filterByVisibility(v.incomingRelationships, "all")).toHaveLength(1);
  });

  it("leaves out relationships that do not touch the centre object", () => {
    const v = buildObjectRelationshipView(nodes, edges, "Project__c");
    expect(v.incomingRelationships.map((c) => c.counterpartObject.nodeKey)).toEqual(["Account"]);
    expect(v.outgoingRelationships.map((c) => c.counterpartObject.nodeKey)).toEqual(["Invoice__c"]);
    expect(v.selfRelationships).toEqual([]);
  });

  it("skips a relationship whose field, owner or target is not in the set", () => {
    const v = buildObjectRelationshipView([obj("Account"), field("Invoice__c", "Account__c")], [hasField("Invoice__c", "Account__c"), lookup("Invoice__c", "Account__c", "Account")], "Account");
    expect(v.counts).toEqual({ incomingTotal: 0, outgoingTotal: 0, selfTotal: 0 });
  });

  it("sorts by field count, then by label", () => {
    const ns = [obj("Hub"), obj("B"), obj("A"), obj("C"), field("A", "h"), field("B", "h"), field("C", "h"), field("C", "h2")];
    const es = [hasField("A", "h"), hasField("B", "h"), hasField("C", "h"), hasField("C", "h2"), lookup("A", "h", "Hub"), lookup("B", "h", "Hub"), lookup("C", "h", "Hub"), lookup("C", "h2", "Hub")];
    const v = buildObjectRelationshipView(ns, es, "Hub");
    expect(v.incomingRelationships.map((c) => c.counterpartObject.label)).toEqual(["C", "A", "B"]);
  });

  it("reads custom from the node attribute, else from the __c suffix", () => {
    const v = buildObjectRelationshipView(nodes, edges, "Account");
    expect(v.rootObject?.isCustom).toBe(false);
    expect(v.incomingRelationships[0].counterpartObject.isCustom).toBe(true);
    expect(v.outgoingRelationships[0].counterpartObject.isCustom).toBe(true); // Project__c, no attribute
  });

  it("returns an empty view without a centre", () => {
    const v = buildObjectRelationshipView(nodes, edges, null);
    expect(v.rootObject).toBeNull();
    expect(v.counts).toEqual({ incomingTotal: 0, outgoingTotal: 0, selfTotal: 0 });
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify({ nodes, edges });
    buildObjectRelationshipView(nodes, edges, "Account");
    expect(JSON.stringify({ nodes, edges })).toBe(before);
    expect(DEFAULT_VISIBLE_PER_LANE).toBe(6);
  });
});
