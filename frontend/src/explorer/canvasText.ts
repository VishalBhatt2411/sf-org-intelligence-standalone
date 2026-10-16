import type { ObjectConnector, ObjectRef, VisibilityMode } from "./objectRelationshipView";

// Pure copy rules for Object analyze mode's canvas (native oiRelationshipCanvas): empty lane text that follows
// the active Business / System / All filter, card aria-labels, the self caption and the export filename.

export type Lane = "incoming" | "outgoing";

export type EmptyLane =
  | { kind: "text"; text: string }
  // Relationships exist, but the active filter hides them all; offers a way to widen it.
  | { kind: "filtered"; text: string; showLabel: string; showMode: VisibilityMode };

export function laneEmptyState(opts: { lane: Lane; mode: VisibilityMode; totalInLane: number; rootLabel: string; record?: boolean }): EmptyLane {
  const { lane, mode, totalInLane, rootLabel, record } = opts;
  if (!record && mode !== "all" && totalInLane > 0) {
    const word = mode === "business" ? "business" : "system";
    return {
      kind: "filtered",
      text: `No ${word} relationships ${lane === "outgoing" ? `from ${rootLabel}` : `to ${rootLabel}`}.`,
      showLabel: mode === "business" ? "Show system relationships" : "Show business relationships",
      showMode: "all",
    };
  }
  if (record) return { kind: "text", text: lane === "incoming" ? "No records reference this record." : "This record has no parent lookups or child records." };
  return { kind: "text", text: lane === "incoming" ? "No objects reference this object." : "This object references no other objects." };
}

const joinFields = (names: string[]): string => names.join(", ");

// "Contact, Standard Object, through AccountId, OwnerId". The fields part is omitted when there are none.
export function cardAriaLabel(connector: ObjectConnector, typeText: string): string {
  const names = connector.fields.map((f) => f.fieldApiName ?? f.fieldFqn ?? "").filter(Boolean);
  const through = names.length ? `, through ${joinFields(names)}` : "";
  return `${connector.counterpartObject.label}, ${typeText}${through}`;
}

export function selfCaption(root: ObjectRef, record: boolean): string {
  const name = record ? (root.secondaryKey ?? root.fqn) : root.label;
  return record ? `${name} record related to another ${name} record` : `Self Relationship\n${name} references ${name}`;
}

export const exportFilename = (root: ObjectRef, record: boolean): string => `${record ? `${root.fqn}-${root.recordId ?? root.label}` : root.fqn}-relationships.svg`;

export const ARROW_MARKER_ID = "oi-orc-arrow";
export const ARROW_PATH = "M0,0 L8,4 L0,8 Z";

export const activateKey = (key: string): boolean => key === "Enter" || key === " ";
