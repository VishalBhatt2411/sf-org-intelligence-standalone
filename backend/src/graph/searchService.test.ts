import { describe, expect, it } from "vitest";
import { GraphInputError } from "./errors";
import { escapeLike } from "./graphReadRepository";
import { keyOfRef, seed, type Ref } from "./graphTestKit";
import { InMemoryGraphRepository } from "./inMemoryGraphRepository";
import { typeKeyOf } from "./keys";
import { BROWSE_MAX_LIMIT, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT, SearchService } from "./searchService";

const C = "c1";
const cls = (n: string): Ref => ["ApexClass", n];

async function fixture(names: string[] = ["InvoiceService", "InvoiceTrigger", "AccountHandler", "invoice_helper"]) {
  const repo = new InMemoryGraphRepository();
  await seed(repo, C, [...names.map(cls), ["CustomObject", "Invoice__c"], ["CustomField", "Invoice__c.Amount__c"]], []);
  return { repo, service: new SearchService(repo) };
}

describe("SearchService.search", () => {
  it("matches a label or full-name prefix case-insensitively and orders by label", async () => {
    const { service } = await fixture();
    const result = await service.search(C, "INV");
    expect(result.nodes.map((n) => n.label)).toEqual(["Amount__c", "InvoiceService", "InvoiceTrigger", "Invoice__c", "invoice_helper"]);
    expect(result.truncated).toBe(false);
    expect(result.query).toBe("INV");
  });

  it("also matches the start of the full name, so Object.Field is findable", async () => {
    const { service } = await fixture();
    const result = await service.search(C, "Invoice__c.");
    expect(result.nodes.map((n) => n.fqn)).toEqual(["Invoice__c.Amount__c"]);
  });

  it("trims the query and does not match in the middle of a name", async () => {
    const { service } = await fixture();
    expect((await service.search(C, "  Account  ")).nodes.map((n) => n.label)).toEqual(["AccountHandler"]);
    expect((await service.search(C, "Service")).nodes).toHaveLength(0);
  });

  it("rejects a query that is too short or too long", async () => {
    const { service } = await fixture();
    await expect(service.search(C, "a")).rejects.toBeInstanceOf(GraphInputError);
    await expect(service.search(C, "  a ")).rejects.toBeInstanceOf(GraphInputError);
    await expect(service.search(C, "")).rejects.toBeInstanceOf(GraphInputError);
    await expect(service.search(C, "x".repeat(101))).rejects.toBeInstanceOf(GraphInputError);
  });

  it("reports truncated when more matched than the limit, without returning the extra row", async () => {
    const { service } = await fixture();
    const result = await service.search(C, "Inv", 2);
    expect(result.nodes).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("clamps the limit to the allowed range", async () => {
    const names = Array.from({ length: 80 }, (_, i) => `Bulk${String(i).padStart(3, "0")}`);
    const { service } = await fixture(names);
    expect((await service.search(C, "Bulk")).nodes).toHaveLength(SEARCH_DEFAULT_LIMIT);
    expect((await service.search(C, "Bulk", 9999)).nodes).toHaveLength(SEARCH_MAX_LIMIT);
    expect((await service.search(C, "Bulk", 0)).nodes).toHaveLength(1);
  });

  it("skips stale nodes and other connections' nodes", async () => {
    const { repo, service } = await fixture();
    await seed(repo, "c2", [cls("InvoiceOther")], []);
    repo.nodes.get(`${C}\u0000${keyOfRef(cls("InvoiceTrigger"))}`)!.state = "stale";
    const labels = (await service.search(C, "Invoice")).nodes.map((n) => n.label);
    expect(labels).not.toContain("InvoiceTrigger");
    expect(labels).not.toContain("InvoiceOther");
  });

  it("treats LIKE wildcards as ordinary characters", async () => {
    const { service } = await fixture();
    expect((await service.search(C, "Inv%")).nodes).toHaveLength(0);
    expect((await service.search(C, "%%")).nodes).toHaveLength(0);
  });
});

describe("escapeLike", () => {
  it("escapes percent, underscore and backslash", () => {
    expect(escapeLike("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
    expect(escapeLike("plain")).toBe("plain");
  });
});

describe("SearchService.browse", () => {
  it("lists one type ordered by label", async () => {
    const { service } = await fixture();
    const result = await service.browse(C, typeKeyOf("ApexClass"));
    expect(result.nodes.map((n) => n.label)).toEqual(["AccountHandler", "InvoiceService", "InvoiceTrigger", "invoice_helper"]);
  });

  it("requires a type, truncates at the limit and clamps it", async () => {
    const names = Array.from({ length: 600 }, (_, i) => `K${String(i).padStart(4, "0")}`);
    const { service } = await fixture(names);
    await expect(service.browse(C, "")).rejects.toBeInstanceOf(GraphInputError);
    const page = await service.browse(C, typeKeyOf("ApexClass"), 5000);
    expect(page.nodes).toHaveLength(BROWSE_MAX_LIMIT);
    expect(page.truncated).toBe(true);
    expect((await service.browse(C, typeKeyOf("CustomObject"))).truncated).toBe(false);
  });

  it("returns nothing for a type the connection does not have", async () => {
    const { service } = await fixture();
    expect((await service.browse(C, typeKeyOf("Flow"))).nodes).toEqual([]);
    expect((await service.browse("c2", typeKeyOf("ApexClass"))).nodes).toEqual([]);
  });
});
