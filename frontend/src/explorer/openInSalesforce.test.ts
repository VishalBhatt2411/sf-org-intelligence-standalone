import { describe, expect, it } from "vitest";
import { NO_INSTANCE_URL, openSetupFor } from "./openInSalesforce";

const account = { kind: "CustomObject", fqn: "Account" };

describe("openSetupFor", () => {
  it("opens with the known instance URL", async () => {
    const opened: string[] = [];
    const r = await openSetupFor(account, { instanceUrl: "https://x.my.salesforce.com", resolveInstanceUrl: async () => null, open: (u) => opened.push(u) });
    expect(r).toEqual({ ok: true });
    expect(opened[0]).toContain("/lightning/setup/ObjectManager/Account/");
  });
  it("resolves the instance URL on demand", async () => {
    const opened: string[] = [];
    const r = await openSetupFor(account, { instanceUrl: null, resolveInstanceUrl: async () => "https://y.my.salesforce.com", open: (u) => opened.push(u) });
    expect(r.ok).toBe(true);
    expect(opened[0].startsWith("https://y.my.salesforce.com")).toBe(true);
  });
  it("reports an inline error when no URL can be found or resolving fails", async () => {
    expect(await openSetupFor(account, { instanceUrl: null, resolveInstanceUrl: async () => null })).toEqual({ ok: false, error: NO_INSTANCE_URL });
    expect(
      await openSetupFor(account, {
        instanceUrl: null,
        resolveInstanceUrl: async () => {
          throw new Error("x");
        },
      }),
    ).toEqual({ ok: false, error: NO_INSTANCE_URL });
  });
  it("surfaces unsupported kinds and caveats", async () => {
    const deps = { instanceUrl: "https://x.com", resolveInstanceUrl: async () => null, open: () => undefined };
    expect((await openSetupFor({ kind: "Mystery", fqn: "M" }, deps)).ok).toBe(false);
    const flow = await openSetupFor({ kind: "Flow", fqn: "F" }, deps);
    expect(flow).toMatchObject({ ok: true });
    expect((flow as { caveat?: string }).caveat).toBeTruthy();
  });
  it("reports a failed navigation", async () => {
    const r = await openSetupFor(account, {
      instanceUrl: "https://x.com",
      resolveInstanceUrl: async () => null,
      open: () => {
        throw new Error("blocked");
      },
    });
    expect(r.ok).toBe(false);
  });
});
