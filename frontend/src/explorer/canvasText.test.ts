import { describe, expect, it } from "vitest";
import { cardAriaLabel, exportFilename, laneEmptyState, selfCaption } from "./canvasText";
import type { ObjectConnector, ObjectRef } from "./objectRelationshipView";

const root: ObjectRef = { nodeKey: "r", label: "Account", fqn: "Account", isCustom: false };
const connector = (names: string[]) =>
  ({ counterpartObject: { nodeKey: "c", label: "Contact", fqn: "Contact", isCustom: false }, fields: names.map((n) => ({ fieldApiName: n, fieldFqn: `Contact.${n}` })) }) as unknown as ObjectConnector;

describe("laneEmptyState", () => {
  it("offers to widen a filter that hides existing relationships, for business and system", () => {
    expect(laneEmptyState({ lane: "outgoing", mode: "business", totalInLane: 3, rootLabel: "Account" })).toMatchObject({ kind: "filtered", text: "No business relationships from Account.", showLabel: "Show system relationships" });
    expect(laneEmptyState({ lane: "incoming", mode: "system", totalInLane: 2, rootLabel: "Account" })).toMatchObject({ kind: "filtered", text: "No system relationships to Account.", showLabel: "Show business relationships" });
  });
  it("uses the plain message when nothing exists or the view is All", () => {
    expect(laneEmptyState({ lane: "incoming", mode: "system", totalInLane: 0, rootLabel: "A" })).toEqual({ kind: "text", text: "No objects reference this object." });
    expect(laneEmptyState({ lane: "outgoing", mode: "all", totalInLane: 0, rootLabel: "A" })).toEqual({ kind: "text", text: "This object references no other objects." });
  });
  it("keeps Record wording", () => {
    expect(laneEmptyState({ lane: "incoming", mode: "all", totalInLane: 0, rootLabel: "A", record: true }).kind).toBe("text");
  });
});

describe("canvas copy", () => {
  it("names the fields a card goes through", () => {
    expect(cardAriaLabel(connector(["AccountId", "OwnerId"]), "Standard Object")).toBe("Contact, Standard Object, through AccountId, OwnerId");
    expect(cardAriaLabel(connector([]), "Standard Object")).toBe("Contact, Standard Object");
  });
  it("captions a self relationship", () => {
    expect(selfCaption(root, false)).toBe("Self Relationship\nAccount references Account");
  });
  it("names exports by fqn", () => {
    expect(exportFilename({ ...root, label: "Acct", fqn: "Acme__c" }, false)).toBe("Acme__c-relationships.svg");
  });
});
