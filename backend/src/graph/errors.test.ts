import { describe, expect, it } from "vitest";
import { isSalesforceSessionError } from "./errors";

describe("isSalesforceSessionError", () => {
  it("recognises the ways jsforce reports a dead session", () => {
    expect(isSalesforceSessionError(new Error("Unable to refresh session due to: expired access/refresh token"))).toBe(true);
    expect(isSalesforceSessionError(Object.assign(new Error("x"), { errorCode: "INVALID_SESSION_ID" }))).toBe(true);
    expect(isSalesforceSessionError(Object.assign(new Error("x"), { name: "invalid_grant" }))).toBe(true);
    expect(isSalesforceSessionError(new Error("invalid_grant: expired access/refresh token"))).toBe(true);
  });

  it("leaves every other failure alone", () => {
    expect(isSalesforceSessionError(new Error("connect ECONNREFUSED"))).toBe(false);
    expect(isSalesforceSessionError(Object.assign(new Error("x"), { errorCode: "MALFORMED_QUERY" }))).toBe(false);
    expect(isSalesforceSessionError(null)).toBe(false);
    expect(isSalesforceSessionError("expired")).toBe(false);
  });
});
