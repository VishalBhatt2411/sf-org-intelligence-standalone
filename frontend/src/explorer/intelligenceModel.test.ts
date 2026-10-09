import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, IntelligenceItem, ObjectField } from "./graphApi";
import {
  buildEmptyStateMessage,
  distinctTargets,
  fieldMetrics,
  filterFields,
  formatTargets,
  groupIntelligenceItems,
  incomingDrillEntries,
  overviewRows,
  pluralizeTypeLabel,
  relationshipCounts,
  targetWithCount,
  technicalAttributes,
  yesNoUnknown,
} from "./intelligenceModel";
import { buildObjectRelationshipView, FIELD_TYPE_KEY, HAS_FIELD_EDGE, LOOKUP_TO_EDGE, MASTER_DETAIL_TO_EDGE, OBJECT_TYPE_KEY } from "./objectRelationshipView";

const field = (name: string, over: Partial<ObjectField> = {}): ObjectField => ({ name, label: name.replace(/__c$/, ""), type: "string", referenceTo: [], masterDetail: false, custom: name.endsWith("__c"), required: null, cascadeDelete: null, relationshipName: null, ...over });

const node = (nodeKey: string, typeKey: string, kind: string, fqn: string, attributes: Record<string, unknown> = {}, label = fqn.split(".").pop()!): GraphNode => ({
  nodeKey, typeKey, kind, kindLabel: kind === "CustomObject" ? "Object" : kind === "CustomField" ? "Field" : kind, categories: [], label, fqn, namespace: null, parentKey: null, checksum: nodeKey, attributes,
});
const edge = (typeKey: string, source: string, target: string): GraphEdge => ({ edgeKey: `${source}>${target}`, typeKey, kind: "", style: "solid", sourceRole: "", targetRole: "", source, target, confidence: "exact", viaField: null, attributes: {} });

describe("pluralizeTypeLabel", () => {
  it("handles sibilants, consonant+y and the plain case", () => {
    expect(pluralizeTypeLabel("Apex Class")).toBe("Apex Classes");
    expect(pluralizeTypeLabel("Entity")).toBe("Entities");
    expect(pluralizeTypeLabel("Day")).toBe("Days");
    expect(pluralizeTypeLabel("Flow")).toBe("Flows");
    expect(pluralizeTypeLabel("Match")).toBe("Matches");
  });
});

describe("buildEmptyStateMessage", () => {
  it("explains each reason a list can be empty", () => {
    expect(buildEmptyStateMessage("Code", "unscanned")).toBe("Code data has not been scanned yet.");
    expect(buildEmptyStateMessage("Code", "stale")).toBe("Results shown are from an older scan — rescan to refresh code data.");
    expect(buildEmptyStateMessage("Code", "incomplete")).toBe("Code results may be incomplete for this org — see the coverage note below.");
    expect(buildEmptyStateMessage("Automation", "none")).toBe("No automation detected for this component.");
  });
});

describe("fields", () => {
  const fields = [field("Name"), field("Amount__c", { type: "currency" }), field("AccountId", { referenceTo: ["Account"] }), field("Owner__c", { referenceTo: ["User", "Group"], custom: true })];

  it("computes the metric tiles", () => {
    expect(fieldMetrics(fields)).toEqual({ total: 4, standard: 2, custom: 2, relationship: 2 });
  });

  it("filters by custom/standard and by a case-insensitive search over label, name and type", () => {
    expect(filterFields(fields, "", "custom").map((f) => f.name)).toEqual(["Amount__c", "Owner__c"]);
    expect(filterFields(fields, "", "standard").map((f) => f.name)).toEqual(["Name", "AccountId"]);
    expect(filterFields(fields, "CURRENCY", "all").map((f) => f.name)).toEqual(["Amount__c"]);
    expect(filterFields(fields, "owner", "custom").map((f) => f.name)).toEqual(["Owner__c"]);
    expect(filterFields(fields, "zzz", "all")).toEqual([]);
  });

  it("collects distinct relationship targets and formats them with a +N more tail", () => {
    expect(distinctTargets(fields)).toEqual(["Account", "Group", "User"]);
    const many = ["A", "B", "C", "D", "E", "F", "G"];
    expect(formatTargets(many)).toEqual({ text: "A, B, C, D, E, +2 more", title: "A, B, C, D, E, F, G" });
    expect(formatTargets(["A"]).text).toBe("A");
  });

  it("labels record counts, including unavailable and uncounted targets", () => {
    const counts = { Account: 12, User: 1, Group: null };
    expect(targetWithCount("Account", counts)).toBe("Account (12 records)");
    expect(targetWithCount("User", counts)).toBe("User (1 record)");
    expect(targetWithCount("Group", counts)).toBe("Group (count unavailable)");
    expect(targetWithCount("Other", counts)).toBe("Other");
    expect(targetWithCount("Account", undefined)).toBe("Account");
  });

  it("renders a missing required/cascade flag as Unknown rather than No", () => {
    expect([yesNoUnknown(true), yesNoUnknown(false), yesNoUnknown(null)]).toEqual(["Yes", "No", "Unknown"]);
  });
});

describe("groupIntelligenceItems", () => {
  const item = (label: string, typeKey: string, direction: "in" | "out", edgeTypeKey: string): IntelligenceItem => ({ nodeKey: label, label, typeKey, kindLabel: typeKey, direction, edgeTypeKey, status: null });

  it("groups by type and allows drill-down only when direction and edge type are uniform", () => {
    const groups = groupIntelligenceItems([item("a", "Flow", "in", "E1"), item("b", "Flow", "in", "E1"), item("c", "Apex", "in", "E1"), item("d", "Apex", "out", "E1")]);
    expect(groups.map((g) => [g.label, g.items.length, g.drillDown])).toEqual([["Apex", 2, false], ["Flow", 2, true]]);
  });
});

describe("relationship counts and overview", () => {
  const acc = node("acc", OBJECT_TYPE_KEY, "CustomObject", "Account", { custom: false });
  const inv = node("inv", OBJECT_TYPE_KEY, "CustomObject", "Invoice__c", { custom: true });
  const fAcc = node("f1", FIELD_TYPE_KEY, "CustomField", "Invoice__c.Account__c");
  const fMd = node("f2", FIELD_TYPE_KEY, "CustomField", "Invoice__c.Parent__c");
  const fSelf = node("f3", FIELD_TYPE_KEY, "CustomField", "Account.ParentId");
  const view = buildObjectRelationshipView(
    [acc, inv, fAcc, fMd, fSelf],
    [edge(HAS_FIELD_EDGE, "inv", "f1"), edge(HAS_FIELD_EDGE, "inv", "f2"), edge(HAS_FIELD_EDGE, "acc", "f3"), edge(LOOKUP_TO_EDGE, "f1", "acc"), edge(MASTER_DETAIL_TO_EDGE, "f2", "acc"), edge(LOOKUP_TO_EDGE, "f3", "acc")],
    "acc",
  );

  it("counts incoming lookups, incoming master-detail, self fields and distinct objects", () => {
    expect(relationshipCounts(view)).toEqual({ incomingLookups: 1, incomingMasterDetail: 1, selfRelationships: 1, referencedObjects: 0, referencingObjects: 1 });
    expect(relationshipCounts(null)).toBeNull();
  });

  it("lists the counterpart behind each incoming count", () => {
    expect(incomingDrillEntries(view, "MasterDetail")).toEqual([{ nodeKey: "inv", label: "Invoice__c", detail: "Invoice__c.Parent__c" }]);
    expect(incomingDrillEntries(null, "Lookup")).toEqual([]);
  });

  it("builds overview rows for objects and fields", () => {
    expect(overviewRows(inv, null)).toEqual([["API Name", "Invoice__c"], ["Type", "Custom Object"], ["Namespace", "—"], ["Custom / Standard", "Custom"]]);
    expect(overviewRows({ ...acc, label: "Account Label" }, null)[0]).toEqual(["Name", "Account Label"]);
    const rows = Object.fromEntries(overviewRows(fAcc, null));
    expect(rows).toMatchObject({ "API Name": "Account__c", "Parent Object": "Invoice__c", "Custom / Standard": "Custom" });
  });

  it("keeps curated attributes out of the technical details", () => {
    expect(technicalAttributes({ attributes: { label: "x", custom: true, status: "Active", referenceTo: ["A"] } })).toEqual([["status", "Active"]]);
  });
});
