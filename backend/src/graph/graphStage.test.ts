import { describe, expect, it } from "vitest";
import { FakeScanInputs } from "./graphInputs";
import { FakeGraphSource } from "./graphSource";
import { runGraphStage, type SectionCoverage } from "./graphStage";
import { InMemoryGraphRepository } from "./inMemoryGraphRepository";
import { keyOf } from "./draft";
import { DEFAULT_GRAPH_SETTINGS } from "./settings";

const SECTION_NAMES = ["objects", "apex_classes", "triggers", "flows", "workflow_rules", "permissions", "sharing_model", "sharing_rules", "dependencies"];
const sections = (over: Record<string, SectionCoverage> = {}) => new Map<string, SectionCoverage>([...SECTION_NAMES.map((n) => [n, { coverage: "complete" } as SectionCoverage] as const), ...Object.entries(over)]);

function fixture() {
  const source = new FakeGraphSource();
  source.objects = [
    { name: "Account", custom: false, queryable: true },
    { name: "Invoice__c", custom: true, queryable: true },
    { name: "Invoice__History", custom: false, queryable: true },
    { name: "pkg__Thing__c", custom: true, queryable: true },
  ];
  source.described = [
    {
      name: "Invoice__c",
      fields: [{ name: "Account__c", label: "Account", type: "reference", referenceTo: ["Account"], masterDetail: false, sfId: null }],
    },
  ];
  source.permissionSets = [{ name: "Billing", label: "Billing", isCustom: true, type: null, namespace: null }];
  source.rules = [{ sfId: "03d000000000001", objectName: "Invoice__c", name: "Amount_Positive", active: true, description: null, errorMessage: "No", namespace: null }];

  const inputs = new FakeScanInputs();
  inputs.stored = [
    { apiName: "Account", label: "Account", sfId: null, fields: [] },
    { apiName: "Invoice__c", label: "Invoice", sfId: "01I000000000001AAA", fields: [{ apiName: "Account__c", type: "reference", referenceTo: ["Account"], sfId: "00N000000000001AAA" }, { apiName: "Amount__c", type: "currency", referenceTo: null, sfId: "00N000000000002AAA" }] },
    { apiName: "Invoice__History", label: "History", sfId: null, fields: [] },
    { apiName: "pkg__Thing__c", label: "Thing", sfId: null, fields: [] },
  ];
  inputs.classes = [
    { name: "InvoiceService", sfId: "01p000000000001AAA", body: "public class InvoiceService { InvoiceHelper h; }", lineCount: 1 },
    { name: "InvoiceHelper", sfId: "01p000000000002AAA", body: "public class InvoiceHelper {}", lineCount: 1 },
  ];
  inputs.apexTriggers = [{ name: "InvoiceTrigger", sfId: "01q000000000001AAA", objectName: "Invoice__c", body: "trigger InvoiceTrigger on Invoice__c (before insert) { InvoiceService s; }" }];
  inputs.permSets = [{ name: "Billing", sfId: "0PS000000000001AAA", permJson: { objectPermissions: { object: "Invoice__c", allowRead: "true" } } }];
  inputs.deps = [{ componentId: "01p000000000001AAA", componentName: "InvoiceService", componentType: "ApexClass", refComponentId: "00N000000000002AAA", refComponentName: "Amount__c", refComponentType: "CustomField" }];

  const repository = new InMemoryGraphRepository();
  let scan = 0;
  const run = (over: Partial<Parameters<typeof runGraphStage>[0]> = {}) => runGraphStage({ source, inputs, repository, connectionId: "c1", scanId: `s${++scan}`, settings: DEFAULT_GRAPH_SETTINGS, sections: sections(), ...over });
  return { source, inputs, repository, run };
}

const active = (repo: InMemoryGraphRepository) => [...repo.nodes.values()].filter((n) => n.state === "active").map((n) => n.fqn).sort();
const stale = (repo: InMemoryGraphRepository) => [...repo.nodes.values()].filter((n) => n.state === "stale").map((n) => n.fqn).sort();
const byCategory = (records: Array<{ category: string; coverage: string }>) => Object.fromEntries(records.map((r) => [r.category, r.coverage]));

describe("runGraphStage", () => {
  it("builds the graph from stored scan data and live reads, honouring scope", async () => {
    const { run, repository } = fixture();
    const result = await run();
    expect(result.degraded).toBe(false);
    expect(result.records.every((r) => r.coverage === "complete")).toBe(true);
    expect(active(repository)).toEqual(["Account", "Billing", "Invoice__c", "Invoice__c.Account__c", "Invoice__c.Amount__c", "Invoice__c.Amount_Positive", "InvoiceHelper", "InvoiceService", "InvoiceTrigger"].sort());

    const edges = [...repository.edges.values()].map((e) => e.typeKey.replace("SalesforceMetadata.", ""));
    for (const type of ["HAS_FIELD", "LOOKUP_TO", "REFERENCES", "EXECUTES_ON", "GRANTS_ACCESS_TO", "VALIDATES", "DEPENDS_ON"]) expect(edges).toContain(type);
    const depends = [...repository.edges.values()].find((e) => e.typeKey.endsWith("DEPENDS_ON"))!;
    expect(depends).toMatchObject({ sourceNodeKey: keyOf("ApexClass", "InvoiceService"), targetNodeKey: keyOf("CustomField", "Invoice__c.Amount__c"), confidence: "exact" });
  });

  it("is idempotent and retires what disappeared after a complete scan", async () => {
    const { run, repository, inputs } = fixture();
    await run();
    const second = await run();
    expect(second.retired).toEqual({ nodes: 0, edges: 0 });

    inputs.classes = inputs.classes.filter((c) => c.name !== "InvoiceHelper");
    const third = await run();
    expect(third.retired.nodes).toBe(1);
    expect(stale(repository)).toEqual(["InvoiceHelper"]);
    expect([...repository.edges.values()].filter((e) => e.state === "stale").length).toBeGreaterThan(0);
  });

  it("isolates a failing stage: it is degraded, the others finish, and its rows are not retired", async () => {
    const { run, repository, source } = fixture();
    await run();
    source.failing.add("validationRules");
    source.rules = [];
    const result = await run();
    expect(result.degraded).toBe(true);
    expect(byCategory(result.records)).toMatchObject({ graph_validation_rules: "degraded", graph_apex_classes: "complete", graph_objects: "complete" });
    expect(result.records.find((r) => r.category === "graph_validation_rules")?.coverageDetail).toContain("validationRules failed");
    expect(active(repository)).toContain("Invoice__c.Amount_Positive");
  });

  it("does not retire anything a main-scan section could not fully read", async () => {
    const { run, repository, inputs } = fixture();
    await run();
    inputs.classes = [];
    const result = await run({ sections: sections({ apex_classes: { coverage: "degraded" } }) });
    expect(byCategory(result.records).graph_apex_classes).toBe("partial");
    expect(stale(repository)).toEqual([]);
  });

  it("is partial, and keeps field nodes, when describe fails for some objects", async () => {
    const { run, repository, source } = fixture();
    await run();
    source.describeFailures = ["Invoice__c"];
    source.described = [];
    const result = await run();
    expect(byCategory(result.records).graph_relationship_fields).toBe("partial");
    expect(result.records.find((r) => r.category === "graph_relationship_fields")?.coverageDetail).toContain("1 object");
    expect(active(repository)).toContain("Invoice__c.Account__c");
  });

  it("writes nothing and reports degraded when scope cannot be determined", async () => {
    const { run, repository, source } = fixture();
    source.failing.add("listObjects");
    const result = await run();
    expect(result.degraded).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ category: "graph_scope", coverage: "degraded" });
    expect(repository.nodes.size).toBe(0);
  });

  it("includes foreign-namespace objects only when the setting is on, and the org's own namespace always", async () => {
    const off = fixture();
    await off.run();
    expect(active(off.repository)).not.toContain("pkg__Thing__c");

    const on = fixture();
    await on.run({ settings: { ...DEFAULT_GRAPH_SETTINGS, scanManagedPackageObjects: true } });
    expect(active(on.repository)).toContain("pkg__Thing__c");

    const own = fixture();
    own.source.namespace = "pkg";
    await own.run();
    expect(active(own.repository)).toContain("pkg__Thing__c");
  });

  it("marks the dependency stage partial when an earlier stage was incomplete", async () => {
    const { run, source } = fixture();
    source.describeFailures = ["Invoice__c"];
    const result = await run();
    expect(byCategory(result.records).graph_dependencies).toBe("partial");
  });

  it("keeps connections apart", async () => {
    const { run, repository } = fixture();
    await run();
    await run({ connectionId: "c2" });
    expect([...repository.nodes.keys()].filter((k) => k.startsWith("c2\u0000")).length).toBe([...repository.nodes.keys()].filter((k) => k.startsWith("c1\u0000")).length);
  });
});
