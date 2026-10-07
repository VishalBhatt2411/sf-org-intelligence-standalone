import { describe, expect, it, beforeAll } from "vitest";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-not-for-production";
});

describe("userAuth", () => {
  it("round-trips a session token", async () => {
    const { signSessionToken, verifySessionToken } = await import("./userAuth");
    const token = signSessionToken({ organizationId: "o1", connectionId: "c1" });
    expect(verifySessionToken(token)).toMatchObject({ organizationId: "o1", connectionId: "c1" });
  });

  it("rejects a tampered token", async () => {
    const { signSessionToken, verifySessionToken } = await import("./userAuth");
    const token = signSessionToken({ organizationId: "o1", connectionId: "c1" });
    expect(() => verifySessionToken(token.slice(0, -2) + "xx")).toThrow();
  });
});
