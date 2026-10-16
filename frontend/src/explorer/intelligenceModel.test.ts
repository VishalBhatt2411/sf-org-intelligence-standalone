import { describe, expect, it } from "vitest";
import type { EdgeSummaryRow, GraphEdge, GraphNode, IntelligenceItem, ObjectField, RelationshipField } from "./graphApi";
import {
  buildEmptyStateMessage,
  cascadeDeleteLabel,
  directConnectionNote,
  distinctTargets,
  fieldMetrics,
  fieldRelationshipRows,
  fieldRowTitle,
  fieldTotals,
  filterFields,
  formatTargets,
  groupIntelligenceItems,
  hasFields,
  impactColumnHeader,
  impactTypeBreakdown,
  incomingEdgeCounts,
  outgoingFieldRows,
  overviewRows,
  pluralizeTypeLabel,
  relationshipCounts,
  relationshipRows,
  sortFieldsByLabel,
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

describe("field totals and rows", () => {
  const summary = (typeKey: string, direction: "in" | "out", count: number): EdgeSummaryRow => ({ typeKey, kind: "", direction, role: "", count, confidence: {} as EdgeSummaryRow["confidence"] });

  it("uses stored counts before the list loads and the list afterwards", () => {
    const withCounts = { attributes: { fieldCount: 10, customFieldCount: 3 } };
    expect(fieldTotals(withCounts, [])).toEqual({ total: 10, standard: 7, custom: 3, relationship: null });
    expect(fieldTotals({ attributes: { fieldCount: 2, customFieldCount: 5 } }, []).standard).toBe(0);
    expect(fieldTotals({ attributes: {} }, [summary("SalesforceMetadata.HAS_FIELD", "out", 8)])).toEqual({ total: 8, standard: null, custom: null, relationship: null });
    expect(fieldTotals(withCounts, [], [field("A__c"), field("B", { referenceTo: ["X"] })])).toEqual({ total: 2, standard: 1, custom: 1, relationship: 1 });
    expect(hasFields(fieldTotals({ attributes: {} }, []))).toBe(false);
    expect(hasFields(fieldTotals(withCounts, []))).toBe(true);
  });

  it("sorts by label and titles rows by whether they are graph nodes", () => {
    expect(sortFieldsByLabel([{ label: "b" }, { label: "A" }, { label: "c" }]).map((f) => f.label)).toEqual(["A", "b", "c"]);
    expect(fieldRowTitle("k")).toBe("Open this field in the graph");
    expect(fieldRowTitle(null)).toBe("Listed from live schema. Only relationship fields are graph nodes.");
  });

  const rel = (apiName: string, over: Partial<RelationshipField> = {}): RelationshipField => ({ nodeKey: apiName, apiName, label: apiName, type: "reference", referenceTo: ["Account"], masterDetail: false, required: null, relationshipName: null, custom: false, ...over });

  it("builds outgoing relationship rows and applies the visibility filter to system lookups", () => {
    const fields = [rel("AccountId", { masterDetail: true, required: false }), rel("OwnerId", { referenceTo: ["User"] })];
    expect(outgoingFieldRows(fields, "all")).toHaveLength(2);
    expect(outgoingFieldRows(fields, "business").map((r) => r.apiName)).toEqual(["AccountId"]);
    expect(outgoingFieldRows(fields, "system").map((r) => r.apiName)).toEqual(["OwnerId"]);
    const [row] = outgoingFieldRows(fields, "business");
    expect(row).toMatchObject({ type: "Master-Detail", required: "No", cascadeDelete: "Cascade" });
    expect(outgoingFieldRows([rel("X")], "all")[0]).toMatchObject({ type: "Lookup", required: "Unknown", cascadeDelete: "Not available" });
    expect(cascadeDeleteLabel({ masterDetail: false })).toBe("Not available");
    expect(distinctTargets(fields)).toEqual(["Account", "User"]);
  });
});

describe("groupIntelligenceItems", () => {
  const item = (label: string, typeKey: string, direction: "in" | "out", edgeTypeKey: string, extra: Partial<IntelligenceItem> = {}): IntelligenceItem => ({ nodeKey: label, label, typeKey, kindLabel: typeKey, direction, edgeTypeKey, status: null, ...extra });

  it("groups by type and allows drill-down only when direction and edge type are uniform", () => {
    const groups = groupIntelligenceItems([item("a", "Flow", "in", "E1"), item("b", "Flow", "in", "E1"), item("c", "Apex", "in", "E1"), item("d", "Apex", "out", "E1")]);
    expect(groups.map((g) => [g.label, g.items.length, g.drillDown])).toEqual([["Apex", 2, false], ["Flow", 2, true]]);
  });

  it("splits a type by sub-type and labels the group with the sub-type", () => {
    const groups = groupIntelligenceItems([item("a", "Flow", "in", "E1"), item("b", "Flow", "in", "E1", { subTypeKey: "ProcessBuilder", subTypeLabel: "Process Builder" })]);
    expect(groups.map((g) => [g.groupKey, g.label])).toEqual([["Flow", "Flow"], ["ProcessBuilder", "Process Builder"]]);
  });
});

describe("relationship counts and overview", () => {
  const acc = node("acc", OBJECT_TYPE_KEY, "CustomObject", "Account", { custom: false });
  const inv = node("inv", OBJECT_TYPE_KEY, "CustomObject", "Invoice__c", { custom: true });
  const fAcc = node("f1", FIELD_TYPE_KEY, "CustomField", "Invoice__c.Account__c", { custom: true, type: "reference" });
  const fMd = node("f2", FIELD_TYPE_KEY, "CustomField", "Invoice__c.Parent__c");
  const fSelf = node("f3", FIELD_TYPE_KEY, "CustomField", "Account.ParentId");
  const view = buildObjectRelationshipView(
    [acc, inv, fAcc, fMd, fSelf],
    [edge(HAS_FIELD_EDGE, "inv", "f1"), edge(HAS_FIELD_EDGE, "inv", "f2"), edge(HAS_FIELD_EDGE, "acc", "f3"), edge(LOOKUP_TO_EDGE, "f1", "acc"), edge(MASTER_DETAIL_TO_EDGE, "f2", "acc"), edge(LOOKUP_TO_EDGE, "f3", "acc")],
    "acc",
  );
  const summaryRow = (typeKey: string, direction: "in" | "out", count: number, role = ""): EdgeSummaryRow => ({ typeKey, kind: typeKey.split(".").pop()!, direction, role, count, confidence: {} as EdgeSummaryRow["confidence"] });

  it("counts connectors for the centre object", () => {
    expect(relationshipCounts(view)).toEqual({ selfRelationships: 1, referencedObjects: 0, referencingObjects: 1 });
    expect(relationshipCounts(null)).toBeNull();
  });

  it("reads incoming lookups and master-detail from the edge summary, defaulting to zero", () => {
    expect(incomingEdgeCounts([summaryRow(LOOKUP_TO_EDGE, "in", 12), summaryRow(MASTER_DETAIL_TO_EDGE, "in", 3), summaryRow(LOOKUP_TO_EDGE, "out", 99)])).toEqual({ incomingLookups: 12, incomingMasterDetail: 3 });
    expect(incomingEdgeCounts([])).toEqual({ incomingLookups: 0, incomingMasterDetail: 0 });
  });

  it("words generic relationship rows and the direct-connection note", () => {
    const rows = relationshipRows([summaryRow("SalesforceMetadata.USES_APEX", "out", 2, "Apex"), summaryRow("SalesforceMetadata.USES_APEX", "in", 1)]);
    expect(rows.map((r) => [r.label, r.direction, r.edgeTypeKey])).toEqual([["Outgoing — Apex", "outgoing", "SalesforceMetadata.USES_APEX"], ["Incoming — Uses Apex", "incoming", "SalesforceMetadata.USES_APEX"]]);
    expect(directConnectionNote(1)).toContain("1 directly connected metadata component —");
    expect(directConnectionNote(4)).toContain("4 directly connected metadata components —");
  });

  it("builds overview rows for objects and fields", () => {
    expect(overviewRows(inv, null)).toEqual([["API Name", "Invoice__c"], ["Type", "Custom Object"], ["Namespace", "—"], ["Custom / Standard", "Custom"]]);
    expect(overviewRows({ ...acc, label: "Account Label" }, null)[0]).toEqual(["Name", "Account Label"]);
    const rows = Object.fromEntries(overviewRows(fAcc, null));
    expect(rows).toMatchObject({ "API Name": "Account__c", "Data Type": "reference", "Parent Object": "Invoice__c", "Custom / Standard": "Custom" });
    expect(overviewRows(fMd, null).some(([k]) => k === "Custom / Standard")).toBe(false);
    expect(overviewRows(node("x", "SalesforceMetadata.Flow", "Flow", "My_Flow", { custom: false }, "My Flow"), null)).toEqual([["Name", "My Flow"], ["API Name", "My_Flow"], ["Type", "Flow"], ["Custom / Standard", "Standard"]]);
  });

  it("shows field relationship rows only when present", () => {
    expect(fieldRelationshipRows({ attributes: {} })).toEqual([]);
    expect(fieldRelationshipRows({ attributes: { relationship: "MasterDetail", referenceTo: ["A", "B"], relationshipName: "Parent__r" } })).toEqual([["Relationship Type", "Master-Detail"], ["Target Object", "A, B"], ["Relationship Name", "Parent__r"]]);
    expect(fieldRelationshipRows({ attributes: { referenceTo: ["A"] } })).toEqual([["Target Object", "A"]]);
  });

  it("keeps curated attributes out of the technical details", () => {
    expect(technicalAttributes({ attributes: { label: "x", custom: true, status: "Active", referenceTo: ["A"], fieldCount: 3 } })).toEqual([["status", "Active"]]);
  });
});

describe("impact", () => {
  const n = (typeKey: string, kindLabel: string) => ({ typeKey, kindLabel });
  it("orders the type breakdown by first appearance and hides a single type", () => {
    expect(impactTypeBreakdown([n("F", "Flow"), n("A", "Apex Class"), n("F", "Flow")])).toEqual([{ typeKey: "F", label: "Flows", count: 2 }, { typeKey: "A", label: "Apex Class", count: 1 }]);
    expect(impactTypeBreakdown([n("F", "Flow"), n("F", "Flow")])).toEqual([]);
  });
  it("names the first column by direction", () => {
    expect(impactColumnHeader("downstream")).toBe("What depends on this");
    expect(impactColumnHeader("upstream")).toBe("What does this depend on");
  });
});

