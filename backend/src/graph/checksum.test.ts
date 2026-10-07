import { describe, expect, it } from "vitest";
import { edgeChecksum, nodeChecksum, stableJson } from "./checksum";
import type { EdgeDraft, NodeDraft } from "./types";

const node = (over: Partial<NodeDraft> = {}): NodeDraft => ({
  typeKey: "SalesforceMetadata.CustomObject",
  namespace: null,
  fqn: "Account",
  label: "Account",
  parentKey: null,
  attributes: { a: 1, b: "x" },
  ...over,
});

const edge = (over: Partial<EdgeDraft> = {}): EdgeDraft => ({
  typeKey: "SalesforceMetadata.REFERENCES",
  sourceNodeKey: "s",
  targetNodeKey: "t",
  confidence: "heuristic",
  attributes: {},
  ...over,
});

describe("stableJson", () => {
  it("is independent of key order, including nested objects", () => {
    expect(stableJson({ b: 1, a: { d: 1, c: 2 } })).toBe(stableJson({ a: { c: 2, d: 1 }, b: 1 }));
  });

  it("treats null and undefined alike and keeps array order", () => {
    expect(stableJson(undefined)).toBe("null");
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
  });
});

describe("nodeChecksum", () => {
  it("is stable and independent of attribute key order", () => {
    expect(nodeChecksum(node())).toBe(nodeChecksum(node({ attributes: { b: "x", a: 1 } })));
  });

  it("changes when label, parent, namespace or any attribute changes", () => {
    const base = nodeChecksum(node());
    expect(nodeChecksum(node({ label: "Acct" }))).not.toBe(base);
    expect(nodeChecksum(node({ parentKey: "p" }))).not.toBe(base);
    expect(nodeChecksum(node({ namespace: "ns" }))).not.toBe(base);
    expect(nodeChecksum(node({ attributes: { a: 2, b: "x" } }))).not.toBe(base);
    expect(nodeChecksum(node({ attributes: { a: 1, b: "x", c: true } }))).not.toBe(base);
  });

  it("treats a null attribute value as present-but-empty, not absent", () => {
    expect(nodeChecksum(node({ attributes: { a: null } }))).not.toBe(nodeChecksum(node({ attributes: {} })));
  });

  it("distinguishes nested attribute values", () => {
    expect(nodeChecksum(node({ attributes: { o: { x: 1 } } }))).not.toBe(nodeChecksum(node({ attributes: { o: { x: 2 } } })));
  });
});

describe("edgeChecksum", () => {
  it("is stable", () => {
    expect(edgeChecksum(edge())).toBe(edgeChecksum(edge()));
  });

  it("changes with confidence and attributes (the Apex original ignored both)", () => {
    const base = edgeChecksum(edge());
    expect(edgeChecksum(edge({ confidence: "exact" }))).not.toBe(base);
    expect(edgeChecksum(edge({ attributes: { count: 2 } }))).not.toBe(base);
  });

  it("changes with endpoints and type", () => {
    const base = edgeChecksum(edge());
    expect(edgeChecksum(edge({ sourceNodeKey: "x" }))).not.toBe(base);
    expect(edgeChecksum(edge({ targetNodeKey: "x" }))).not.toBe(base);
    expect(edgeChecksum(edge({ typeKey: "SalesforceMetadata.DEPENDS_ON" }))).not.toBe(base);
  });
});
