import { describe, expect, it } from "vitest";
import { FakeHealthSource, type FakeData } from "../fakeHealthSource";
import type { SecuritySet } from "../healthSource";
import { CONNECTION, NOW, withConfig } from "../healthTestKit";
import { computeSecurity } from "./security";

const set = (id: string, over: Partial<SecuritySet> = {}): SecuritySet => ({ id, name: `Set_${id}`, label: `Set ${id}`, namespace: null, profileOwned: false, flags: [], ...over });

async function run(data: FakeData, config = withConfig({})) {
  const source = new FakeHealthSource(data);
  return { source, ...(await computeSecurity({ source, connectionId: CONNECTION, config, now: NOW })) };
}

describe("computeSecurity", () => {
  it("is live, unscored, and reports 'nothing evaluated' when permission sets cannot be read", async () => {
    const { result, candidates } = await run({ failing: ["securitySets"] });
    expect(result).toMatchObject({ section: "security", scored: false, score: null, basis: "live" });
    expect(result.coverage.complete).toBe(false);
    expect(result.unavailable).toEqual(["Permission sets could not be read"]);
    expect(candidates).toEqual([]);
  });

  it("flags Modify All Data as critical and names it in the finding", async () => {
    const { result, candidates } = await run({ sets: [set("1", { flags: ["PermissionsModifyAllData"] })], assignments: { "1": 4 } });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ section: "security", ruleKey: "SecurityHealth.ElevatedPermissions", severity: "critical", componentType: "Permission Set", componentLabel: "Set 1", measured: "1 elevated permission: Modify All Data" });
    expect(candidates[0].impact).toContain("4 users");
    expect(result.kpis.find((k) => k.key === "Elevated")).toMatchObject({ value: "1", basis: "live" });
    expect(result.breakdown.rows[0].metrics.find((m) => m.column === "Users")?.value).toBe("4");
  });

  it("ignores a small permission like Customize Application on its own", async () => {
    const { candidates } = await run({ sets: [set("1", { flags: ["PermissionsCustomizeApplication"] })], assignments: { "1": 4 } });
    expect(candidates).toEqual([]);
  });

  it("softens the risk of a set nobody is assigned to, and raises it for widely assigned sets", async () => {
    const view = set("1", { flags: ["PermissionsViewAllData"] });
    const unused = await run({ sets: [view], assignments: { "1": 0 } });
    expect(unused.candidates).toEqual([]);
    const some = await run({ sets: [view], assignments: { "1": 3 } });
    const many = await run({ sets: [view], assignments: { "1": 40 } });
    expect(some.candidates[0].severity).toBe("warning");
    expect(many.candidates[0].score).toBeGreaterThan(some.candidates[0].score);
  });

  it("flags broad object access only from the configured number of objects", async () => {
    const sets = [set("1")];
    const few = await run({ sets, broad: [{ permissionSetId: "1", modifyAll: 1, viewAll: 1 }], assignments: { "1": 5 } });
    expect(few.candidates).toEqual([]);
    const many = await run({ sets, broad: [{ permissionSetId: "1", modifyAll: 5, viewAll: 4 }], assignments: { "1": 5 } });
    expect(many.candidates.map((c) => c.ruleKey)).toEqual(["SecurityHealth.BroadObjectGrant"]);
    expect(many.candidates[0].measured).toBe("5 Modify All, 4 View All");
  });

  it("flags access to sensitive objects and only counts the configured ones", async () => {
    const data: FakeData = {
      sets: [set("1")],
      assignments: { "1": 5 },
      sensitive: [
        { permissionSetId: "1", object: "Contact", modifyAll: true, viewAll: false, delete: true },
        { permissionSetId: "1", object: "Lead", modifyAll: false, viewAll: true, delete: false },
        { permissionSetId: "1", object: "Invoice__c", modifyAll: true, viewAll: true, delete: true },
      ],
    };
    const { candidates } = await run(data);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].ruleKey).toBe("SecurityHealth.SensitiveObjectGrant");
    expect(candidates[0].measured).toBe("Wide access to Contact, Lead");
    const custom = await run(data, withConfig({ security: { threshold: 1, broadObjectThreshold: 5, sensitiveObjects: ["Invoice__c"] } }));
    expect(custom.candidates[0].measured).toBe("Wide access to Invoice__c");
  });

  it("skips managed-package sets and says so", async () => {
    const { result, candidates } = await run({ sets: [set("1", { flags: ["PermissionsModifyAllData"], namespace: "acme" }), set("2")] });
    expect(candidates).toEqual([]);
    expect(result.coverage.note).toContain("1 managed-package set skipped");
    expect(result.kpis.find((k) => k.key === "Reviewed")?.value).toBe("1");
  });

  it("labels a profile as a profile", async () => {
    const { candidates } = await run({ sets: [set("1", { label: "Custom Admin", profileOwned: true, flags: ["PermissionsModifyAllData"] })], assignments: { "1": 2 } });
    expect(candidates[0].componentType).toBe("Profile");
  });

  it("degrades gracefully when one of the supporting reads fails", async () => {
    const { result, candidates } = await run({ sets: [set("1", { flags: ["PermissionsModifyAllData"] })], failing: ["assignmentCounts", "broadGrants"] });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].impact).toContain("an unknown number of users");
    expect(result.unavailable).toHaveLength(2);
    expect(result.coverage.complete).toBe(false);
  });

  it("reports partial coverage at the ceiling", async () => {
    const { result } = await run({ sets: [set("1")], setsTruncated: true });
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.note).toContain("ceiling reached");
  });

  it("keeps the breakdown to 8 rows with a Top X of Y caption for a large org", async () => {
    const sets = Array.from({ length: 300 }, (_, i) => set(String(i), { flags: ["PermissionsModifyAllData"] }));
    const assignments = Object.fromEntries(sets.map((s) => [s.id, 3]));
    const { result, candidates } = await run({ sets, assignments });
    expect(result.breakdown.rows).toHaveLength(8);
    expect(result.breakdown.caption).toBe("Top 8 of 300");
    expect(candidates).toHaveLength(300);
  });
});
