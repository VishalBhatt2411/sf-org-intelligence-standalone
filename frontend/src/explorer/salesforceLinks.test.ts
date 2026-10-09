import { describe, expect, it } from "vitest";
import { fieldsSetupUrl, objectOfField, objectSetupUrl } from "./salesforceLinks";

describe("salesforceLinks", () => {
  it("builds the object details link and tolerates a trailing slash", () => {
    expect(objectSetupUrl("https://acme.my.salesforce.com/", "Account")).toBe("https://acme.my.salesforce.com/lightning/setup/ObjectManager/Account/Details/view");
  });

  it("builds the fields list link and encodes the name", () => {
    expect(fieldsSetupUrl("https://acme.my.salesforce.com", "Inv__c")).toBe("https://acme.my.salesforce.com/lightning/setup/ObjectManager/Inv__c/FieldsAndRelationships/view");
  });

  it("derives the owning object from a field name", () => {
    expect(objectOfField("Account.OwnerId")).toBe("Account");
    expect(objectOfField("Account")).toBe("Account");
  });
});
