import { describe, expect, it } from "vitest";
import { fieldsSetupUrl, metadataSetupTarget, objectOfField, objectSetupUrl, recordUrl } from "./salesforceLinks";

describe("salesforceLinks", () => {
  it("builds the object details link and tolerates a trailing slash", () => {
    expect(objectSetupUrl("https://acme.my.salesforce.com/", "Account")).toBe("https://acme.my.salesforce.com/lightning/setup/ObjectManager/Account/Details/view");
  });

  it("builds the fields list link and encodes the name", () => {
    expect(fieldsSetupUrl("https://acme.my.salesforce.com", "Inv__c")).toBe("https://acme.my.salesforce.com/lightning/setup/ObjectManager/Inv__c/FieldsAndRelationships/view");
  });

  it("builds a record detail link", () => {
    expect(recordUrl("https://acme.my.salesforce.com/", "Account", "001A")).toBe("https://acme.my.salesforce.com/lightning/r/Account/001A/view");
  });

  it("derives the owning object from a field name", () => {
    expect(objectOfField("Account.OwnerId")).toBe("Account");
    expect(objectOfField("Account")).toBe("Account");
  });

  describe("metadataSetupTarget", () => {
    const org = "https://acme.my.salesforce.com/";
    const url = (t: ReturnType<typeof metadataSetupTarget>) => t.url;

    it("opens an object's details page", () => {
      expect(url(metadataSetupTarget(org, { kind: "CustomObject", fqn: "Invoice__c" }))).toBe("https://acme.my.salesforce.com/lightning/setup/ObjectManager/Invoice__c/Details/view");
    });

    it("opens a standard field by name, and a standard lookup by its relationship name", () => {
      expect(url(metadataSetupTarget(org, { kind: "CustomField", fqn: "Account.Industry", attributes: { custom: false } }))).toBe("https://acme.my.salesforce.com/lightning/setup/ObjectManager/Account/FieldsAndRelationships/Industry/view");
      expect(url(metadataSetupTarget(org, { kind: "CustomField", fqn: "Account.OwnerId", attributes: { custom: false, relationship: true, relationshipName: "Owner", referenceTo: ["User"] } }))).toBe("https://acme.my.salesforce.com/lightning/setup/ObjectManager/Account/FieldsAndRelationships/Owner/view");
    });

    it("opens a custom field by its DurableId when known, else the fields list with a caveat", () => {
      expect(url(metadataSetupTarget(org, { kind: "CustomField", fqn: "Account.Tier__c", attributes: { durableId: "Account.00N5g00000AbCdE" } }))).toBe("https://acme.my.salesforce.com/lightning/setup/ObjectManager/Account/FieldsAndRelationships/00N5g00000AbCdE/view");
      const fallback = metadataSetupTarget(org, { kind: "CustomField", fqn: "Account.Tier__c", attributes: { custom: true } });
      expect(fallback.url).toBe("https://acme.my.salesforce.com/lightning/setup/ObjectManager/Account/FieldsAndRelationships/view");
      expect("caveat" in fallback && fallback.caveat).toBeTruthy();
    });

    it("opens Apex, triggers and permission sets by id, else their lists", () => {
      expect(url(metadataSetupTarget(org, { kind: "ApexClass", fqn: "InvoiceService", attributes: { sfId: "01p000000000001" } }))).toBe("https://acme.my.salesforce.com/lightning/setup/ApexClasses/page?address=%2F01p000000000001");
      expect(url(metadataSetupTarget(org, { kind: "ApexTrigger", fqn: "InvoiceTrigger", attributes: { id: "01q000000000001" } }))).toBe("https://acme.my.salesforce.com/lightning/setup/ApexTriggers/page?address=%2F01q000000000001");
      expect(url(metadataSetupTarget(org, { kind: "PermissionSet", fqn: "Sales", attributes: { sfId: "0PS000000000001" } }))).toBe("https://acme.my.salesforce.com/lightning/setup/PermSets/page?address=%2F0PS000000000001");
      const noId = metadataSetupTarget(org, { kind: "ApexClass", fqn: "InvoiceService" });
      expect(noId.url).toBe("https://acme.my.salesforce.com/lightning/setup/ApexClasses/home");
      expect("caveat" in noId && noId.caveat).toBeTruthy();
    });

    it("opens the Flows list with native's caveat, and validation rules on their object", () => {
      const flow = metadataSetupTarget(org, { kind: "Flow", fqn: "Invoice_Flow" });
      expect(flow.url).toBe("https://acme.my.salesforce.com/lightning/setup/Flows/home");
      expect("caveat" in flow && flow.caveat).toMatch(/stable direct link/);
      expect(url(metadataSetupTarget(org, { kind: "ValidationRule", fqn: "Invoice__c.Amount_Positive", attributes: { objectApiName: "Invoice__c" } }))).toBe("https://acme.my.salesforce.com/lightning/setup/ObjectManager/Invoice__c/ValidationRules/view");
    });

    it("says when a kind cannot be opened", () => {
      const t = metadataSetupTarget(org, { kind: "LightningComponent", fqn: "ns.card" });
      expect(t.url).toBeNull();
      expect("reason" in t && t.reason).toBe("Opening LightningComponent components is not supported yet.");
    });
  });
});
