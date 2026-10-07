import { describe, expect, it } from "vitest";
import { keyOf } from "./draft";
import { ObjectIndex, normaliseSfId } from "./objectIndex";

describe("ObjectIndex", () => {
  const index = new ObjectIndex([
    { name: "Account" },
    { name: "Invoice__c", sfId: "01I5g000000AbCdEAK" },
    { name: "Account" },
  ]);

  it("resolves names case-insensitively to the canonical name and node key", () => {
    expect(index.resolve("account")).toEqual({ name: "Account", nodeKey: keyOf("CustomObject", "Account") });
    expect(index.resolve("INVOICE__C")?.name).toBe("Invoice__c");
  });

  it("ignores duplicates", () => {
    expect(index.size).toBe(2);
    expect(index.names().sort()).toEqual(["Account", "Invoice__c"]);
  });

  it("resolves a custom object by its 18- or 15-character Id", () => {
    expect(index.resolve("01I5g000000AbCdEAK")?.name).toBe("Invoice__c");
    expect(index.resolve("01I5g000000AbCd")?.name).toBe("Invoice__c");
  });

  it("returns null for unknown names, unknown Ids, blanks and null", () => {
    expect(index.resolve("Contact")).toBeNull();
    expect(index.resolve("01I5g000000ZzZzEAK")).toBeNull();
    expect(index.resolve("")).toBeNull();
    expect(index.resolve(null)).toBeNull();
    expect(index.resolve(undefined)).toBeNull();
  });

  it("does not treat a malformed Id as an Id", () => {
    expect(new ObjectIndex([{ name: "X__c", sfId: "short" }]).resolve("short")).toBeNull();
  });
});

describe("normaliseSfId", () => {
  it("truncates to the case-sensitive 15 characters", () => {
    expect(normaliseSfId("01I5g000000AbCdEAK")).toBe("01I5g000000AbCd");
    expect(normaliseSfId("01I5g000000AbCd")).toBe("01I5g000000AbCd");
  });
});
