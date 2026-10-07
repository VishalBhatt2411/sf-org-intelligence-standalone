import { describe, expect, it, beforeAll } from "vitest";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = "test-key-not-for-production";
});

describe("crypto", () => {
  it("round-trips a plaintext string", async () => {
    const { encrypt, decrypt } = await import("./crypto");
    const stored = encrypt("00Dxx0000000abcEAA!secret-token-value");
    expect(stored).not.toContain("secret-token-value");
    expect(decrypt(stored)).toBe("00Dxx0000000abcEAA!secret-token-value");
  });

  it("round-trips an empty string", async () => {
    const { encrypt, decrypt } = await import("./crypto");
    expect(decrypt(encrypt(""))).toBe("");
  });

  it("produces a different ciphertext each time (random IV)", async () => {
    const { encrypt } = await import("./crypto");
    expect(encrypt("same input")).not.toBe(encrypt("same input"));
  });
});
