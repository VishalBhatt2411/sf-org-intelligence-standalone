import { describe, expect, it } from "vitest";
import { HealthInputError, HealthNotFoundError } from "../errors";
import { candidate } from "./findingTestKit";
import { syncFindings } from "./findingSync";
import { applyTriage } from "./findingTriage";
import { InMemoryFindingRepository } from "./inMemoryFindingRepository";

const C = "conn-1";
const NOW = new Date("2026-10-08T10:00:00Z");

async function setup() {
  const repo = new InMemoryFindingRepository();
  await syncFindings(repo, C, "code", [candidate()], { runId: null, now: NOW, autoResolve: true });
  return { repo, id: [...repo.findings.keys()][0] };
}

describe("applyTriage", () => {
  it("updates fields, trims text and writes one audit event per change", async () => {
    const { repo, id } = await setup();
    const saved = await applyTriage(repo, C, id, { status: "in_progress", owner: "  Sam  ", dueDate: "2026-11-01" }, "org-1", NOW);
    expect(saved).toMatchObject({ status: "in_progress", owner: "Sam" });
    expect(saved.dueDate?.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(repo.allEvents.map((e) => [e.field, e.oldValue, e.changedBy])).toEqual([["status", "open", "org-1"], ["owner", null, "org-1"], ["dueDate", null, "org-1"]]);
    expect(repo.allEvents.find((e) => e.field === "owner")?.newValue).toBe("Sam");
  });

  it("writes nothing when nothing changes", async () => {
    const { repo, id } = await setup();
    await applyTriage(repo, C, id, { status: "open", owner: null }, "a", NOW);
    expect(repo.allEvents).toEqual([]);
  });

  it("clears a field with null or blank text", async () => {
    const { repo, id } = await setup();
    await applyTriage(repo, C, id, { notes: "x" }, "a", NOW);
    const saved = await applyTriage(repo, C, id, { notes: "   " }, "a", NOW);
    expect(saved.notes).toBeNull();
  });

  it("stamps resolvedAt when resolved by hand and clears it when reopened", async () => {
    const { repo, id } = await setup();
    expect((await applyTriage(repo, C, id, { status: "resolved" }, "a", NOW)).resolvedAt).toEqual(NOW);
    expect((await applyTriage(repo, C, id, { status: "open" }, "a", NOW)).resolvedAt).toBeNull();
  });

  it("requires a justification for a false positive", async () => {
    const { repo, id } = await setup();
    await expect(applyTriage(repo, C, id, { status: "false_positive" }, "a", NOW)).rejects.toThrow(/falsePositiveReason/);
    const saved = await applyTriage(repo, C, id, { status: "false_positive", falsePositiveReason: "generated code" }, "a", NOW);
    expect(saved.status).toBe("false_positive");
  });

  it("requires a risk acceptance expiry to be in the future", async () => {
    const { repo, id } = await setup();
    await expect(applyTriage(repo, C, id, { status: "risk_accepted", riskAcceptanceExpiry: "2026-01-01" }, "a", NOW)).rejects.toThrow(/future/);
    const saved = await applyTriage(repo, C, id, { status: "risk_accepted", riskAcceptanceExpiry: "2027-01-01" }, "a", NOW);
    expect(saved.status).toBe("risk_accepted");
  });

  it.each([
    [{ status: "bogus" }, /status/],
    [{ owner: 5 }, /owner/],
    [{ owner: "x".repeat(121) }, /at most 120/],
    [{ dueDate: "tomorrow" }, /date/],
    [{ dueDate: "2026-13-45" }, /valid date/],
    [{ severity: "good" }, /Cannot change: severity/],
    [[], /object/],
    [null, /object/],
  ])("rejects bad input %j", async (body, message) => {
    const { repo, id } = await setup();
    await expect(applyTriage(repo, C, id, body, "a", NOW)).rejects.toThrow(message);
    await expect(applyTriage(repo, C, id, body, "a", NOW)).rejects.toBeInstanceOf(HealthInputError);
  });

  it("does not see a finding of another connection", async () => {
    const { repo, id } = await setup();
    await expect(applyTriage(repo, "conn-2", id, { owner: "x" }, "a", NOW)).rejects.toBeInstanceOf(HealthNotFoundError);
  });
});
