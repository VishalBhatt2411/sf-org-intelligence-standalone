import { describe, expect, it } from "vitest";
import type { RecordEdge, RecordNode } from "./graphApi";
import { RECORD_CHILD_EDGE, RECORD_PARENT_EDGE, buildRecordRelationshipView } from "./recordRelationshipView";

const rec = (objectApiName: string, id: string, label: string): RecordNode => ({ nodeKey: `Record::${objectApiName}::${id}`, typeKey: `SalesforceRecord.${objectApiName}`, label, objectApiName, recordId: id });
const parent = (from: RecordNode, to: RecordNode, via = "OwnerId"): RecordEdge => ({ edgeKey: `${from.nodeKey}>${to.nodeKey}`, typeKey: RECORD_PARENT_EDGE, source: from.nodeKey, target: to.nodeKey, viaField: via });
const child = (from: RecordNode, to: RecordNode, via = "AccountId"): RecordEdge => ({ edgeKey: `${from.nodeKey}>${to.nodeKey}`, typeKey: RECORD_CHILD_EDGE, source: from.nodeKey, target: to.nodeKey, viaField: via });

const acme = rec("Account", "001A", "Acme");
const pat = rec("User", "005A", "Pat Owner");
const casey = rec("Contact", "003A", "Casey");
const dana = rec("Contact", "003B", "Dana");
const globex = rec("Account", "001B", "Globex");

describe("buildRecordRelationshipView", () => {
  it("puts parents on the outgoing side and children on the incoming side", () => {
    const v = buildRecordRelationshipView([acme, pat, casey], [parent(acme, pat), child(acme, casey)], acme.nodeKey);
    expect(v.rootObject).toMatchObject({ nodeKey: acme.nodeKey, label: "Acme", secondaryKey: "Account", recordId: "001A", isCustom: false });
    expect(v.outgoingRelationships.map((c) => c.counterpartObject.label)).toEqual(["Pat Owner"]);
    expect(v.incomingRelationships.map((c) => c.counterpartObject.label)).toEqual(["Casey"]);
    expect(v.counts).toEqual({ incomingTotal: 1, outgoingTotal: 1, selfTotal: 0 });
  });

  it("treats a counterpart of the same object as a self relationship", () => {
    const v = buildRecordRelationshipView([acme, globex], [parent(acme, globex, "ParentId")], acme.nodeKey);
    expect(v.selfRelationships.map((c) => c.counterpartObject.label)).toEqual(["Globex"]);
    expect(v.outgoingRelationships).toEqual([]);
  });

  it("carries no field breakdown and states Related Record wording", () => {
    const v = buildRecordRelationshipView([acme, casey], [child(acme, casey)], acme.nodeKey);
    const c = v.incomingRelationships[0];
    expect(c.fields).toEqual([]);
    expect(c.labelOverride).toBe("Related Record");
    expect(c.isSystemRelationship).toBe(false);
    expect(c.primaryRelationshipType).toBe("Lookup");
  });

  it("merges repeated edges to one record into one plural connector", () => {
    const v = buildRecordRelationshipView([acme, pat], [parent(acme, pat, "OwnerId"), parent(acme, pat, "CreatedById")], acme.nodeKey);
    expect(v.outgoingRelationships).toHaveLength(1);
    expect(v.outgoingRelationships[0]).toMatchObject({ relationshipCount: 2, labelOverride: "2 Related Records" });
  });

  it("sorts connectors by label and ignores edges that miss the centre or a node", () => {
    const v = buildRecordRelationshipView([acme, casey, dana, pat], [child(acme, dana), child(acme, casey), parent(casey, pat), parent(acme, rec("User", "005Z", "Ghost"))], acme.nodeKey);
    expect(v.incomingRelationships.map((c) => c.counterpartObject.label)).toEqual(["Casey", "Dana"]);
    expect(v.outgoingRelationships).toEqual([]);
  });

  it("returns an empty view when the centre is unknown", () => {
    const v = buildRecordRelationshipView([acme], [], "Record::Account::none");
    expect(v.rootObject).toBeNull();
    expect(v.counts).toEqual({ incomingTotal: 0, outgoingTotal: 0, selfTotal: 0 });
  });

  it("does not mutate its input", () => {
    const nodes = [acme, pat];
    const edges = [parent(acme, pat)];
    const before = JSON.stringify([nodes, edges]);
    buildRecordRelationshipView(nodes, edges, acme.nodeKey);
    expect(JSON.stringify([nodes, edges])).toBe(before);
  });
});
