import { describe, expect, it } from "vitest";
import { isFieldNamespaceInScope, isForeignNamespaced, isObjectInScope } from "../scope";
import { resolveGraphSettings } from "../settings";
import { ObjectIndex } from "../objectIndex";
import { scanApexClasses } from "./apex";
import { flowDefinitionIndex, scanFlows } from "./flows";
import { permissionSetMetaIndex } from "./permissionSets";
import { scanValidationRules } from "./objectRules";

const base = { scanManagedPackageObjects: false, scanCustomizedStandardObjects: true };
const scope = { settings: base, orgNamespace: null };
const index = new ObjectIndex([{ name: "Account", sfId: null }]);

describe("scope overrides and namespaces", () => {
  it("honours always-include and always-exclude, with exclude winning", () => {
    const opts = { settings: { ...base, alwaysIncludeObjects: ["Idea", "Account"], alwaysExcludeObjects: ["account"] }, orgNamespace: null };
    expect(isObjectInScope({ name: "Idea", custom: false, queryable: true, customFieldCount: 0 }, opts)).toBe(true);
    expect(isObjectInScope({ name: "Account", custom: false, queryable: true, customFieldCount: 0 }, opts)).toBe(false);
    expect(isObjectInScope({ name: "Idea", custom: false, queryable: false, customFieldCount: 0 }, opts)).toBe(false);
  });
  it("detects foreign-namespaced names", () => {
    expect(isForeignNamespaced("Field__c", null)).toBe(false);
    expect(isForeignNamespaced("pkg__Field__c", null)).toBe(true);
    expect(isForeignNamespaced("own__Field__c", "own")).toBe(false);
    expect(isFieldNamespaceInScope("pkg__F__c", scope)).toBe(false);
    expect(isFieldNamespaceInScope("pkg__F__c", { ...scope, settings: { ...base, scanManagedPackageObjects: true } })).toBe(true);
  });
  it("resolves override lists from stored settings", () => {
    const s = resolveGraphSettings({ alwaysIncludeObjects: [" Idea ", "Idea", 5], alwaysExcludeObjects: "x" });
    expect(s.alwaysIncludeObjects).toEqual(["Idea"]);
    expect(s.alwaysExcludeObjects).toEqual([]);
  });
});

describe("native attribute parity", () => {
  it("flows take processType, version and activity from FlowDefinitionView", () => {
    const defs = flowDefinitionIndex([
      { apiName: "F", label: "F", description: "d", processType: "Workflow", triggerType: "RecordAfterSave", triggerObjectOrEventId: "Account", isActive: false, versionNumber: 3, namespace: null, manageableState: "unmanaged" },
    ]);
    const out = scanFlows([{ apiName: "F", label: "F", status: "Active", triggerType: null, objectName: null, sfId: null }], index, scope, defs);
    expect(out.nodes[0].attributes).toMatchObject({ subType: "ProcessBuilder", isActive: false, versionNumber: 3, description: "d", triggerObjectApiName: "Account", manageableState: "unmanaged" });
    expect(out.edges).toHaveLength(1);
  });
  it("body-less packaged classes become namespaced nodes with native attributes", () => {
    const out = scanApexClasses(
      [{ name: "Hidden", sfId: "01p000000000001AAA", body: "", lineCount: 0, meta: { namespace: "pkg", status: "Active", isValid: true, bodyCrc: 7, lengthWithoutComments: 9, apiVersion: 50 } }],
      { settings: { ...base, scanManagedPackageObjects: true }, orgNamespace: null }
    );
    expect(out.nodes[0]).toMatchObject({ fqn: "pkg.Hidden", namespace: "pkg" });
    expect(out.nodes[0].attributes).toMatchObject({ status: "Active", isValid: true, bodyCrc: 7, lengthWithoutComments: 9 });
    expect(scanApexClasses([{ name: "Hidden", sfId: null, body: "", lineCount: 0, meta: { namespace: "pkg", status: null, isValid: null, bodyCrc: null, lengthWithoutComments: null, apiVersion: null } }], scope).nodes).toEqual([]);
  });
  it("profile-owned permission sets are never indexed", () => {
    const idx = permissionSetMetaIndex([
      { name: "X00e", label: null, isCustom: false, type: "Profile", namespace: null, isOwnedByProfile: true },
      { name: "Real", label: "Real", isCustom: true, type: null, namespace: null },
    ]);
    expect(idx.has("X00e")).toBe(false);
    expect(idx.has("Real")).toBe(true);
  });
  it("validation rules carry formula and error display field", () => {
    const out = scanValidationRules(
      [{ sfId: null, objectName: "Account", name: "R", active: true, description: null, errorMessage: "m", namespace: null, errorConditionFormula: "ISBLANK(Name)", errorDisplayField: "Name" }],
      index,
      scope
    );
    expect(out.nodes[0].attributes).toMatchObject({ errorConditionFormula: "ISBLANK(Name)", errorDisplayField: "Name" });
  });
});
