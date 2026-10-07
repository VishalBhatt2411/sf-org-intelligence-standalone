import { describe, expect, it } from "vitest";
import {
  componentKey,
  edgeKey,
  kindOfTypeKey,
  namespaceFromApiName,
  nodeKey,
  nodeKeyFor,
  parseComponentKey,
  typeKeyOf,
} from "./keys";

describe("nodeKey", () => {
  it("is deterministic and a 64-char sha256 hex", () => {
    const a = nodeKey("SalesforceMetadata.CustomObject", null, "Account");
    expect(a).toBe(nodeKey("SalesforceMetadata.CustomObject", null, "Account"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats a null, undefined and empty namespace as the same namespace", () => {
    const k = nodeKey("SalesforceMetadata.ApexClass", null, "Foo");
    expect(nodeKey("SalesforceMetadata.ApexClass", undefined, "Foo")).toBe(k);
    expect(nodeKey("SalesforceMetadata.ApexClass", "", "Foo")).toBe(k);
  });

  it("differs by namespace, type and fqn", () => {
    const base = nodeKey("SalesforceMetadata.ApexClass", null, "Foo");
    expect(nodeKey("SalesforceMetadata.ApexClass", "ns", "Foo")).not.toBe(base);
    expect(nodeKey("SalesforceMetadata.Flow", null, "Foo")).not.toBe(base);
    expect(nodeKey("SalesforceMetadata.ApexClass", null, "Bar")).not.toBe(base);
  });

  it("nodeKeyFor matches nodeKey with the prefixed type key", () => {
    expect(nodeKeyFor("Flow", "ns", "My_Flow")).toBe(nodeKey(typeKeyOf("Flow"), "ns", "My_Flow"));
  });
});

describe("edgeKey", () => {
  it("is directional", () => {
    expect(edgeKey("a", "SalesforceMetadata.REFERENCES", "b")).not.toBe(edgeKey("b", "SalesforceMetadata.REFERENCES", "a"));
  });

  it("differs by edge type", () => {
    expect(edgeKey("a", "SalesforceMetadata.REFERENCES", "b")).not.toBe(edgeKey("a", "SalesforceMetadata.DEPENDS_ON", "b"));
  });
});

describe("typeKey helpers", () => {
  it("round-trips a kind and passes unprefixed values through", () => {
    expect(kindOfTypeKey(typeKeyOf("ApexClass"))).toBe("ApexClass");
    expect(kindOfTypeKey("Other")).toBe("Other");
  });
});

describe("componentKey / parseComponentKey", () => {
  it("round-trips with and without a namespace", () => {
    expect(parseComponentKey(componentKey("ApexClass", "ns", "Foo"))).toEqual({ kind: "ApexClass", namespace: "ns", fqn: "Foo" });
    expect(parseComponentKey(componentKey("ApexClass", null, "Foo"))).toEqual({ kind: "ApexClass", namespace: null, fqn: "Foo" });
  });

  it("keeps an fqn that contains '::' intact", () => {
    expect(parseComponentKey(componentKey("CustomField", null, "Account.A::B"))).toEqual({
      kind: "CustomField",
      namespace: null,
      fqn: "Account.A::B",
    });
  });

  it("returns null for malformed keys", () => {
    expect(parseComponentKey("nothing")).toBeNull();
    expect(parseComponentKey("only::one")).toBeNull();
    expect(parseComponentKey("::ns::Foo")).toBeNull();
    expect(parseComponentKey("Kind::ns::")).toBeNull();
  });
});

describe("namespaceFromApiName", () => {
  it("extracts the namespace from ns__Name__c", () => {
    expect(namespaceFromApiName("npsp__Foo__c")).toBe("npsp");
  });

  it("returns null for local custom, standard and empty names", () => {
    expect(namespaceFromApiName("Foo__c")).toBeNull();
    expect(namespaceFromApiName("Account")).toBeNull();
    expect(namespaceFromApiName("")).toBeNull();
    expect(namespaceFromApiName(null)).toBeNull();
    expect(namespaceFromApiName(undefined)).toBeNull();
  });

  it("ignores trailing empty segments", () => {
    expect(namespaceFromApiName("Foo__c__")).toBeNull();
  });
});
