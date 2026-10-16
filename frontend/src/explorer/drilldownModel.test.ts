import { describe, expect, it } from "vitest";
import { countText, drilldownSubtitle, emptyStateCopy, nextSort, optionalColumns, rowSetupRef, sortRows } from "./drilldownModel";
import type { ConnectionRow } from "./graphApi";

const row = (over: Partial<ConnectionRow>): ConnectionRow => ({
  nodeKey: "k", label: "L", apiName: "A", typeKey: "SalesforceMetadata.ApexClass", typeLabel: "Apex Class", relationshipLabel: "References", roleLabel: "References",
  direction: "incoming", viaFieldApiName: null, dataType: null, referencedObject: null, isCustom: null, status: null, ...over,
});

describe("sorting", () => {
  it("toggles direction on the same column and restarts ascending on another", () => {
    expect(nextSort(null, "label")).toEqual({ key: "label", dir: "asc" });
    expect(nextSort({ key: "label", dir: "asc" }, "label")).toEqual({ key: "label", dir: "desc" });
    expect(nextSort({ key: "label", dir: "desc" }, "apiName")).toEqual({ key: "apiName", dir: "asc" });
  });
  it("keeps blanks last in both directions", () => {
    const rows = [row({ label: "b" }), row({ label: "" }), row({ label: "a" })];
    expect(sortRows(rows, { key: "label", dir: "asc" }).map((r) => r.label)).toEqual(["a", "b", ""]);
    expect(sortRows(rows, { key: "label", dir: "desc" }).map((r) => r.label)).toEqual(["b", "a", ""]);
    expect(sortRows(rows, null).map((r) => r.label)).toEqual(["b", "", "a"]);
  });
});

describe("columns and copy", () => {
  it("shows optional columns only when some row has a value", () => {
    expect(optionalColumns([row({})])).toEqual({ status: false, dataType: false, references: false });
    expect(optionalColumns([row({}), row({ status: "active", dataType: "Lookup", referencedObject: "Account" })])).toEqual({ status: true, dataType: true, references: true });
  });
  it("words the count line", () => {
    expect(countText(true, 0, 0, false)).toBe("Loading…");
    expect(countText(false, 1, 1, false)).toBe("1 result");
    expect(countText(false, 250, 100, false)).toBe("250 results · showing 100");
    expect(countText(false, 3, 3, true)).toBe("3 matching results");
  });
  it("words empty states and the subtitle", () => {
    expect(emptyStateCopy(true).title).toBe("No matches");
    expect(emptyStateCopy(false).title).toBe("No connections");
    expect(drilldownSubtitle("incoming", "Has Field")).toBe("Incoming · Has Field");
    expect(drilldownSubtitle("outgoing", "Has Field")).toBe("Outgoing · Has Field");
  });
  it("builds a Setup reference from the type key", () => {
    expect(rowSetupRef(row({ typeKey: "SalesforceMetadata.CustomField", apiName: "Account.X__c", isCustom: true }))).toMatchObject({ kind: "CustomField", fqn: "Account.X__c", attributes: { custom: true } });
  });
});
