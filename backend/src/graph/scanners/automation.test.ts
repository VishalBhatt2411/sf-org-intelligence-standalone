import { describe, expect, it } from "vitest";
import { keyOf } from "../draft";
import { ObjectIndex } from "../objectIndex";
import { scanFlows } from "./flows";
import type { FlowInput, PermissionSetInput, PermissionSetMeta } from "./inputs";
import { scanApprovalProcesses, scanEmailAlerts, scanSharingRules, scanValidationRules, scanWorkflowRules } from "./objectRules";
import { isPermissionSetInScope, scanPermissionSets, type PermissionScopeOptions } from "./permissionSets";

const index = new ObjectIndex([{ name: "Account" }, { name: "Invoice__c", sfId: "01I5g000000AbCdEAK" }]);
const accountKey = keyOf("CustomObject", "Account");
const scope = { settings: { scanManagedPackageObjects: false, scanCustomizedStandardObjects: true }, orgNamespace: null };
const permScope = (over: Partial<PermissionScopeOptions["settings"]> = {}): PermissionScopeOptions => ({ settings: { ...scope.settings, scanStandardPermissionSets: false, ...over }, orgNamespace: null });

const flow = (over: Partial<FlowInput> = {}): FlowInput => ({ apiName: "F", label: "F", status: "Active", triggerType: "RecordAfterSave", objectName: "Account", sfId: null, ...over });

describe("scanFlows", () => {
  it("emits the node and an exact EXECUTES_ON with the trigger type", () => {
    const out = scanFlows([flow({ sfId: "300000000000001AAA" })], index);
    expect(out.nodes[0].attributes).toEqual({ status: "Active", triggerType: "RecordAfterSave", objectApiName: "Account" });
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({ typeKey: "SalesforceMetadata.EXECUTES_ON", confidence: "exact", targetNodeKey: accountKey, attributes: { triggerType: "RecordAfterSave" } });
    expect(out.ids).toEqual([["300000000000001AAA", keyOf("Flow", "F")]]);
  });

  it("emits no edge for a screen flow or an out-of-scope object", () => {
    expect(scanFlows([flow({ objectName: null, triggerType: null }), flow({ apiName: "G", objectName: "Other__c" })], index).edges).toEqual([]);
  });

  it("falls back to the API name for a blank label and handles no flows", () => {
    expect(scanFlows([flow({ label: "" })], index).nodes[0].label).toBe("F");
    expect(scanFlows([], index)).toEqual({ nodes: [], edges: [], ids: [] });
  });

  it("scales to many flows", () => {
    expect(scanFlows(Array.from({ length: 1000 }, (_, i) => flow({ apiName: `F${i}` })), index).edges).toHaveLength(1000);
  });
});

describe("scanPermissionSets", () => {
  const set = (name: string, permJson: unknown, sfId: string | null = null): PermissionSetInput => ({ name, permJson, sfId });
  const meta = (name: string, over: Partial<PermissionSetMeta> = {}): [string, PermissionSetMeta] => [name, { name, label: name, isCustom: true, type: null, namespace: null, ...over }];
  const classKeys = new Map([["handler", keyOf("ApexClass", "Handler")]]);

  it("grants access to objects with the flags that are on, and to enabled classes", () => {
    const out = scanPermissionSets(
      [set("PS", { objectPermissions: [{ object: "Account", allowRead: true, allowEdit: "true", allowCreate: false }], classAccesses: [{ apexClass: "Handler", enabled: true }] }, "0PS000000000001AAA")],
      new Map([meta("PS")]),
      index,
      classKeys,
      permScope()
    );
    expect(out.edges.map((e) => [e.targetNodeKey, e.attributes])).toEqual([
      [accountKey, { grantedPermissions: ["read", "edit"] }],
      [keyOf("ApexClass", "Handler"), { grantedPermissions: ["execute"] }],
    ]);
    expect(out.edges.every((e) => e.confidence === "exact")).toBe(true);
    expect(out.ids).toEqual([["0PS000000000001AAA", keyOf("PermissionSet", "PS")]]);
  });

  it("accepts single, unwrapped elements and ignores no-op grants, disabled and unknown targets", () => {
    const out = scanPermissionSets(
      [set("PS", { objectPermissions: { object: "Invoice__c", viewAllRecords: "true" }, classAccesses: [{ apexClass: "Handler", enabled: false }, { apexClass: "Gone", enabled: true }] })],
      new Map([meta("PS")]),
      index,
      classKeys,
      permScope()
    );
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0].attributes).toEqual({ grantedPermissions: ["view all"] });
    const none = scanPermissionSets(
      [set("PS", { objectPermissions: [{ object: "Account", allowRead: false }, { object: "Other__c", allowRead: true }] })],
      new Map([meta("PS")]),
      index,
      classKeys,
      permScope()
    );
    expect(none.edges).toEqual([]);
    expect(none.nodes).toHaveLength(1);
  });

  it("matches a namespace-qualified class name and survives a malformed permJson", () => {
    const out = scanPermissionSets([set("PS", { classAccesses: [{ apexClass: "ns.Handler", enabled: true }] }), set("Bad", null), set("Worse", "x")], new Map(), index, classKeys, permScope());
    expect(out.edges).toHaveLength(1);
    expect(out.nodes).toHaveLength(3);
  });

  it("applies the scope rules", () => {
    const o = permScope();
    expect(isPermissionSetInScope("A", undefined, o)).toBe(true);
    expect(isPermissionSetInScope("A", meta("A", { type: "Group" })[1], o)).toBe(false);
    expect(isPermissionSetInScope("A", meta("A", { isCustom: false })[1], o)).toBe(false);
    expect(isPermissionSetInScope("A", meta("A", { isCustom: false })[1], permScope({ scanStandardPermissionSets: true }))).toBe(true);
    expect(isPermissionSetInScope("A", meta("A", { namespace: "pkg" })[1], o)).toBe(false);
    expect(isPermissionSetInScope("A", meta("A", { namespace: "pkg" })[1], permScope({ scanManagedPackageObjects: true }))).toBe(true);
    expect(isPermissionSetInScope("pkg__Admin", undefined, o)).toBe(false);
    expect(isPermissionSetInScope("pkg__Admin", undefined, { ...o, orgNamespace: "pkg" })).toBe(true);
  });

  it("skips sets out of scope entirely", () => {
    const out = scanPermissionSets([set("Std", { objectPermissions: [{ object: "Account", allowRead: true }] })], new Map([meta("Std", { isCustom: false })]), index, classKeys, permScope());
    expect(out).toEqual({ nodes: [], edges: [], ids: [] });
  });

  it("scales to many sets and grants", () => {
    const sets = Array.from({ length: 300 }, (_, i) => set(`PS${i}`, { objectPermissions: [{ object: "Account", allowRead: true }, { object: "Invoice__c", allowRead: true }] }));
    expect(scanPermissionSets(sets, new Map(), index, classKeys, permScope()).edges).toHaveLength(600);
  });
});

describe("object-attached rules", () => {
  it("validation rules VALIDATE their object and are named Object.Rule", () => {
    const out = scanValidationRules([{ sfId: "03d000000000001AAA", objectName: "Account", name: "Req", active: true, description: null, errorMessage: "No", namespace: null }], index, scope);
    expect(out.nodes[0]).toMatchObject({ fqn: "Account.Req", parentKey: accountKey, attributes: { active: true, errorMessage: "No", objectApiName: "Account" } });
    expect(out.edges[0]).toMatchObject({ typeKey: "SalesforceMetadata.VALIDATES", targetNodeKey: accountKey });
    expect(out.ids).toEqual([["03d000000000001AAA", out.edges[0].sourceNodeKey]]);
  });

  it("the same rule name on two objects yields two nodes", () => {
    const rule = (objectName: string) => ({ sfId: null, objectName, name: "Req", active: true, description: null, errorMessage: null, namespace: null });
    const out = scanValidationRules([rule("Account"), rule("Invoice__c")], index, scope);
    expect(new Set(out.nodes.map((n) => n.fqn))).toEqual(new Set(["Account.Req", "Invoice__c.Req"]));
    expect(out.edges).toHaveLength(2);
  });

  it("skips rules on out-of-scope objects and managed-package rules unless enabled", () => {
    const rule = (objectName: string, namespace: string | null) => ({ sfId: null, objectName, name: "R", active: true, description: null, errorMessage: null, namespace });
    expect(scanValidationRules([rule("Other__c", null)], index, scope).nodes).toEqual([]);
    expect(scanValidationRules([rule("Account", "pkg")], index, scope).nodes).toEqual([]);
    expect(scanValidationRules([rule("Account", "pkg")], index, { ...scope, settings: { ...scope.settings, scanManagedPackageObjects: true } }).nodes).toHaveLength(1);
  });

  it("workflow rules, email alerts, approval processes and sharing rules APPLY_TO their object", () => {
    const wf = scanWorkflowRules([{ sfId: null, objectName: "Account", name: "W", active: true, triggerType: "onCreateOnly" }], index);
    const ea = scanEmailAlerts([{ sfId: null, objectName: "Account", name: "E", description: "d", namespace: null }], index, scope);
    const ap = scanApprovalProcesses([{ sfId: null, objectName: "01I5g000000AbCdEAK", name: "A", label: "", state: "Active", description: null, namespace: null }], index, scope);
    const sr = scanSharingRules([{ objectName: "Account", name: "S", ruleType: "criteria", accessLevel: "Read" }], index);
    for (const out of [wf, ea, ap, sr]) {
      expect(out.nodes).toHaveLength(1);
      expect(out.edges[0].typeKey).toBe("SalesforceMetadata.APPLIES_TO");
    }
    expect(ap.nodes[0]).toMatchObject({ fqn: "Invoice__c.A", label: "A" });
    expect(ap.edges[0].targetNodeKey).toBe(keyOf("CustomObject", "Invoice__c"));
  });

  it("handles no input", () => {
    expect(scanWorkflowRules([], index)).toEqual({ nodes: [], edges: [], ids: [] });
  });
});
