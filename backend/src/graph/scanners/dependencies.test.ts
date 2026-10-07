import { describe, expect, it } from "vitest";
import { keyOf } from "../draft";
import { ObjectIndex } from "../objectIndex";
import { scanDependencies, type DependencyContext } from "./dependencies";
import type { DependencyInput, StoredFieldInfo } from "./inputs";

const index = new ObjectIndex([{ name: "Account" }, { name: "Invoice__c", sfId: "01I5g000000AbCdEAK" }]);
const classKey = keyOf("ApexClass", "Handler");
const flowKey = keyOf("Flow", "F");
const field: StoredFieldInfo = { objectName: "Account", fieldName: "Tier__c", label: "Tier", type: "picklist" };

const ctx = (over: Partial<DependencyContext> = {}): DependencyContext => ({
  idToKey: new Map([["01p000000000001", classKey], ["300000000000001", flowKey]]),
  knownKeys: new Set([classKey, flowKey]),
  fieldBySfId: new Map([["00N000000000001", field]]),
  index,
  ...over,
});

const dep = (over: Partial<DependencyInput>): DependencyInput => ({
  componentId: "01p000000000001AAA",
  componentName: "Handler",
  componentType: "ApexClass",
  refComponentId: "300000000000001AAA",
  refComponentName: "F",
  refComponentType: "Flow",
  ...over,
});

describe("scanDependencies", () => {
  it("resolves endpoints by Id regardless of 15/18-character form", () => {
    const out = scanDependencies([dep({})], ctx());
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({ typeKey: "SalesforceMetadata.DEPENDS_ON", sourceNodeKey: classKey, targetNodeKey: flowKey, confidence: "exact" });
    expect(out.unresolved).toBe(0);
  });

  it("resolves standard and custom objects by name, and custom objects by Id", () => {
    const out = scanDependencies(
      [
        dep({ refComponentId: "000000000000000AAA", refComponentName: "Account", refComponentType: "StandardEntity" }),
        dep({ refComponentId: "01I5g000000AbCdEAK", refComponentName: "Invoice__c", refComponentType: "CustomObject" }),
      ],
      ctx()
    );
    expect(out.edges.map((e) => e.targetNodeKey)).toEqual([keyOf("CustomObject", "Account"), keyOf("CustomObject", "Invoice__c")]);
  });

  it("materialises a depended-on field once, under its object, with HAS_FIELD", () => {
    const out = scanDependencies([dep({ refComponentId: "00N000000000001AAA", refComponentName: "Tier__c", refComponentType: "CustomField" }), dep({ componentId: "300000000000001AAA", componentType: "Flow", refComponentId: "00N000000000001AAA", refComponentName: "Tier__c", refComponentType: "CustomField" })], ctx());
    const fieldKey = keyOf("CustomField", "Account.Tier__c");
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0]).toMatchObject({ fqn: "Account.Tier__c", parentKey: keyOf("CustomObject", "Account"), attributes: { label: "Tier", type: "picklist" } });
    expect(out.edges.filter((e) => e.typeKey.endsWith("HAS_FIELD"))).toHaveLength(1);
    expect(out.edges.filter((e) => e.typeKey.endsWith("DEPENDS_ON")).map((e) => e.targetNodeKey)).toEqual([fieldKey, fieldKey]);
  });

  it("does not rebuild a field an earlier stage already emitted", () => {
    const fieldKey = keyOf("CustomField", "Account.Tier__c");
    const out = scanDependencies([dep({ refComponentId: "00N000000000001AAA", refComponentType: "CustomField" })], ctx({ knownKeys: new Set([classKey, flowKey, fieldKey]) }));
    expect(out.nodes).toEqual([]);
    expect(out.edges.map((e) => e.typeKey)).toEqual(["SalesforceMetadata.DEPENDS_ON"]);
  });

  it("drops a field-to-own-object dependency, self dependencies and duplicates", () => {
    const out = scanDependencies(
      [
        dep({ componentId: "00N000000000001AAA", componentType: "CustomField", refComponentId: "000000000000000AAA", refComponentName: "Account", refComponentType: "StandardEntity" }),
        dep({ refComponentId: "01p000000000001AAA", refComponentName: "Handler", refComponentType: "ApexClass" }),
        dep({}),
        dep({}),
      ],
      ctx()
    );
    expect(out.edges.filter((e) => e.typeKey.endsWith("DEPENDS_ON"))).toHaveLength(1);
  });

  it("counts and skips endpoints it cannot resolve", () => {
    const out = scanDependencies(
      [
        dep({ refComponentId: "0Zz000000000009AAA", refComponentType: "Layout" }),
        dep({ refComponentId: "00N000000000009AAA", refComponentType: "CustomField" }),
        dep({ refComponentId: "000000000000000AAA", refComponentName: "Group", refComponentType: "StandardEntity" }),
      ],
      ctx()
    );
    expect(out.edges).toEqual([]);
    expect(out.unresolved).toBe(3);
  });

  it("skips a field whose object is out of scope", () => {
    const out = scanDependencies([dep({ refComponentId: "00N000000000001AAA", refComponentType: "CustomField" })], ctx({ fieldBySfId: new Map([["00N000000000001", { ...field, objectName: "Other__c" }]]) }));
    expect(out.unresolved).toBe(1);
    expect(out.nodes).toEqual([]);
  });

  it("handles no dependencies and scales", () => {
    expect(scanDependencies([], ctx())).toEqual({ nodes: [], edges: [], ids: [], unresolved: 0 });
    const many = Array.from({ length: 5000 }, (_, i) => dep({ componentId: "01p000000000001AAA", refComponentId: `300${String(i).padStart(12, "0")}AAA` }));
    const idToKey = new Map(many.map((d, i) => [d.refComponentId.slice(0, 15), keyOf("Flow", `F${i}`)] as [string, string]));
    idToKey.set("01p000000000001", classKey);
    expect(scanDependencies(many, ctx({ idToKey })).edges).toHaveLength(5000);
  });
});
