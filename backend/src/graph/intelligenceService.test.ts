import { describe, expect, it } from "vitest";
import { GraphNotFoundError } from "./errors";
import { keyOfRef, seed, type EdgeSpec, type Ref } from "./graphTestKit";
import { InMemoryGraphRepository } from "./inMemoryGraphRepository";
import { INTELLIGENCE_ITEM_CAP, IntelligenceService, STALE_AFTER_MS, statusOf } from "./intelligenceService";

const C = "c1";
const obj: Ref = ["CustomObject", "Invoice__c"];
const field: Ref = ["CustomField", "Invoice__c.Amount__c"];
const cls: Ref = ["ApexClass", "InvoiceSvc"];
const flow: Ref = ["Flow", "Invoice_Flow"];
const flowOld: Ref = ["Flow", "Invoice_Old"];
const perm: Ref = ["PermissionSet", "Billing"];
const rule: Ref = ["ValidationRule", "Invoice__c.Positive"];

const edge = (type: string, from: Ref, to: Ref): EdgeSpec => ({ type, from, to });
const nowMs = Date.parse("2026-06-01T00:00:00.000Z");
const scanned = (finishedAt: Date, stages: Array<{ category: string; coverage: "complete" | "partial" | "degraded" | null; detail?: string | null }> = []) => ({
  scanId: "s1",
  finishedAt,
  stages: stages.map((s) => ({ category: s.category, coverage: s.coverage, detail: s.detail ?? null, itemCount: 1 })),
});

async function fixture() {
  const repo = new InMemoryGraphRepository();
  await seed(repo, C, [obj, [field[0], field[1], obj], cls, flow, flowOld, perm, rule], [
    edge("HAS_FIELD", obj, field),
    edge("REFERENCES", cls, obj),
    edge("EXECUTES_ON", flow, obj),
    edge("EXECUTES_ON", flowOld, obj),
    edge("GRANTS_ACCESS_TO", perm, obj),
    edge("VALIDATES", rule, obj),
  ]);
  repo.nodes.get(`${C}\u0000${keyOfRef(flow)}`)!.attributes = { status: "Active" };
  repo.nodes.get(`${C}\u0000${keyOfRef(flowOld)}`)!.attributes = { status: "Obsolete" };
  repo.nodes.get(`${C}\u0000${keyOfRef(rule)}`)!.attributes = { active: false };
  return { repo, service: new IntelligenceService(repo, () => nowMs) };
}

const category = (result: Awaited<ReturnType<IntelligenceService["forNode"]>>, key: string) => result.categories.find((c) => c.category === key)!;

describe("IntelligenceService.forNode", () => {
  it("groups neighbours by category with direction and status, skipping the field structure", async () => {
    const { service } = await fixture();
    const result = await service.forNode(C, keyOfRef(obj));
    expect(result.categories.map((c) => c.category)).toEqual(["automation", "code", "security"]);
    const automation = category(result, "automation");
    expect(automation.total).toBe(3);
    expect(automation.items.map((i) => [i.label, i.status, i.direction])).toEqual(
      expect.arrayContaining([
        ["Invoice_Flow", "active", "in"],
        ["Invoice_Old", "obsolete", "in"],
        ["Positive", "inactive", "in"],
      ])
    );
    expect(category(result, "code").items.map((i) => i.label)).toEqual(["InvoiceSvc"]);
    expect(category(result, "security").items.map((i) => i.label)).toEqual(["Billing"]);
    // The field is structure, not automation, code or security.
    expect(result.categories.flatMap((c) => c.items).some((i) => i.label === "Invoice__c.Amount__c")).toBe(false);
  });

  it("reports an unscanned org as unscanned rather than as a genuine zero", async () => {
    const { service } = await fixture();
    const result = await service.forNode(C, keyOfRef(field));
    expect(result.lastScannedAt).toBeNull();
    expect(category(result, "automation")).toMatchObject({ items: [], emptyState: "unscanned" });
  });

  it("distinguishes a genuine none, stale data and incomplete coverage when a list is empty", async () => {
    const { repo, service } = await fixture();
    const key = keyOfRef(field);

    repo.coverage.set(C, scanned(new Date(nowMs - 1000), [{ category: "graph_flows", coverage: "complete" }]));
    expect(category(await service.forNode(C, key), "automation").emptyState).toBe("none");

    repo.coverage.set(C, scanned(new Date(nowMs - STALE_AFTER_MS - 1000), [{ category: "graph_flows", coverage: "complete" }]));
    expect(category(await service.forNode(C, key), "automation").emptyState).toBe("stale");

    repo.coverage.set(C, scanned(new Date(nowMs - 1000), [{ category: "graph_flows", coverage: "partial", detail: "limit reached" }]));
    const incomplete = await service.forNode(C, key);
    expect(category(incomplete, "automation")).toMatchObject({ emptyState: "incomplete", coverageNote: "flows: partial (limit reached)" });
    expect(category(incomplete, "security")).toMatchObject({ emptyState: "none", coverageNote: null });
    expect(incomplete.hasCoverageLimitations).toBe(true);
  });

  it("flags a list as truncated and caps the items returned", async () => {
    const repo = new InMemoryGraphRepository();
    const names = Array.from({ length: INTELLIGENCE_ITEM_CAP + 5 }, (_, i) => `Cls${String(i).padStart(4, "0")}`);
    await seed(repo, C, [obj, ...names.map((n): Ref => ["ApexClass", n])], names.map((n) => edge("REFERENCES", ["ApexClass", n], obj)));
    const code = category(await new IntelligenceService(repo, () => nowMs).forNode(C, keyOfRef(obj)), "code");
    expect(code.items).toHaveLength(INTELLIGENCE_ITEM_CAP);
    expect(code).toMatchObject({ total: INTELLIGENCE_ITEM_CAP + 5, truncated: true });
  });

  it("throws not-found for an unknown or foreign node", async () => {
    const { service } = await fixture();
    await expect(service.forNode(C, keyOfRef(["ApexClass", "Nope"]))).rejects.toBeInstanceOf(GraphNotFoundError);
    await expect(service.forNode("c2", keyOfRef(obj))).rejects.toBeInstanceOf(GraphNotFoundError);
  });
});

describe("statusOf", () => {
  const node = (attributes: Record<string, unknown>) => ({ attributes }) as Parameters<typeof statusOf>[0];

  it("reads booleans, flow statuses and approval states, and is null when nothing says", () => {
    expect(statusOf(node({ active: true }))).toBe("active");
    expect(statusOf(node({ active: false }))).toBe("inactive");
    expect(statusOf(node({ status: "Draft" }))).toBe("draft");
    expect(statusOf(node({ status: "InvalidDraft" }))).toBe("draft");
    expect(statusOf(node({ state: "Inactive" }))).toBe("inactive");
    expect(statusOf(node({ status: "Weird" }))).toBeNull();
    expect(statusOf(node({}))).toBeNull();
  });
});
