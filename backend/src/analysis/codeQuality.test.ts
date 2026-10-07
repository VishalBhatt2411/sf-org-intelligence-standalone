import { describe, expect, it } from "vitest";
import { findInLoop } from "./codeQuality";

describe("findInLoop", () => {
  it("flags a SOQL query inside a for loop", () => {
    const body = `
      for (Account a : accounts) {
        List<Contact> c = [SELECT Id FROM Contact WHERE AccountId = :a.Id];
      }
    `;
    expect(findInLoop(body, /\[\s*SELECT/i)).toBe(true);
  });

  it("does not flag a query outside any loop", () => {
    const body = `
      List<Contact> c = [SELECT Id FROM Contact];
      for (Contact x : c) { x.Name = 'test'; }
    `;
    expect(findInLoop(body, /\[\s*SELECT/i)).toBe(false);
  });

  it("stops treating lines as in-loop once the loop's braces close", () => {
    const body = `
      for (Integer i = 0; i < 10; i++) {
        System.debug(i);
      }
      List<Contact> c = [SELECT Id FROM Contact];
    `;
    expect(findInLoop(body, /\[\s*SELECT/i)).toBe(false);
  });
});
