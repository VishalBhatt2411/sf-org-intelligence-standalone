import { describe, expect, it } from "vitest";
import { hasNoiseSuffix, isNamespaceInScope, isObjectInScope, isRelationshipFieldCandidate, STANDARD_OBJECT_ALLOWLIST, type ScopeOptions } from "./scope";

const options = (over: Partial<ScopeOptions["settings"]> = {}, orgNamespace: string | null = null): ScopeOptions => ({
  settings: { scanManagedPackageObjects: false, scanCustomizedStandardObjects: true, ...over },
  orgNamespace,
});

const candidate = (name: string, over: Partial<{ custom: boolean; queryable: boolean; customFieldCount: number }> = {}) => ({
  name,
  custom: name.endsWith("__c"),
  queryable: true,
  customFieldCount: 0,
  ...over,
});

describe("hasNoiseSuffix", () => {
  it("flags companion and non-record objects", () => {
    for (const n of ["Foo__mdt", "Evt__e", "Big__b", "Ext__x", "AccountHistory", "AccountShare", "AccountFeed", "AccountChangeEvent"]) {
      expect(hasNoiseSuffix(n)).toBe(true);
    }
  });

  it("does not flag ordinary objects", () => {
    expect(hasNoiseSuffix("Account")).toBe(false);
    expect(hasNoiseSuffix("Invoice__c")).toBe(false);
  });
});

describe("isNamespaceInScope", () => {
  it("always includes un-namespaced components", () => {
    expect(isNamespaceInScope(null, options())).toBe(true);
  });

  it("includes the org's own namespace case-insensitively", () => {
    expect(isNamespaceInScope("MyNs", options({}, "myns"))).toBe(true);
  });

  it("excludes a foreign namespace unless managed packages are enabled", () => {
    expect(isNamespaceInScope("other", options({}, "myns"))).toBe(false);
    expect(isNamespaceInScope("other", options({ scanManagedPackageObjects: true }, "myns"))).toBe(true);
  });

  it("treats every namespace as foreign when the org has none", () => {
    expect(isNamespaceInScope("other", options())).toBe(false);
  });
});

describe("isObjectInScope", () => {
  it("excludes non-queryable and noise objects first", () => {
    expect(isObjectInScope(candidate("Invoice__c", { queryable: false }), options())).toBe(false);
    expect(isObjectInScope(candidate("AccountHistory", { customFieldCount: 5 }), options())).toBe(false);
    expect(isObjectInScope(candidate("Setting__mdt"), options())).toBe(false);
  });

  it("includes local custom objects", () => {
    expect(isObjectInScope(candidate("Invoice__c"), options())).toBe(true);
  });

  it("includes foreign-namespace custom objects only when enabled", () => {
    expect(isObjectInScope(candidate("pkg__Thing__c"), options())).toBe(false);
    expect(isObjectInScope(candidate("pkg__Thing__c"), options({ scanManagedPackageObjects: true }))).toBe(true);
  });

  it("includes every allow-listed standard object even with no custom fields", () => {
    for (const name of STANDARD_OBJECT_ALLOWLIST) {
      expect(isObjectInScope(candidate(name, { custom: false }), options({ scanCustomizedStandardObjects: false }))).toBe(true);
    }
  });

  it("includes other standard objects only when customised and the setting is on", () => {
    expect(isObjectInScope(candidate("Solution", { customFieldCount: 0 }), options())).toBe(false);
    expect(isObjectInScope(candidate("Solution", { customFieldCount: 2 }), options())).toBe(true);
    expect(isObjectInScope(candidate("Solution", { customFieldCount: 2 }), options({ scanCustomizedStandardObjects: false }))).toBe(false);
  });

  it("keeps the allow-list at 20 distinct names", () => {
    expect(new Set(STANDARD_OBJECT_ALLOWLIST).size).toBe(20);
  });
});

describe("isRelationshipFieldCandidate", () => {
  it("accepts a reference field with targets", () => {
    expect(isRelationshipFieldCandidate({ name: "Account__c", type: "reference", referenceTo: ["Account"] })).toBe(true);
  });

  it("rejects non-reference types, empty targets and null targets", () => {
    expect(isRelationshipFieldCandidate({ name: "X__c", type: "string", referenceTo: ["Account"] })).toBe(false);
    expect(isRelationshipFieldCandidate({ name: "X__c", type: "reference", referenceTo: [] })).toBe(false);
    expect(isRelationshipFieldCandidate({ name: "X__c", type: "reference", referenceTo: null })).toBe(false);
  });

  it("rejects system relationship fields", () => {
    for (const name of ["CreatedById", "LastModifiedById", "OwnerId"]) {
      expect(isRelationshipFieldCandidate({ name, type: "reference", referenceTo: ["User"] })).toBe(false);
    }
  });
});
