import { describe, expect, it } from "vitest";
import { keyOf } from "../draft";
import { ObjectIndex } from "../objectIndex";
import { classKeyIndex, parseTriggerHeader, referencedNames, scanApexClasses, scanApexTriggers, stripNonCode } from "./apex";
import type { ApexClassInput, ApexTriggerInput } from "./inputs";

const cls = (name: string, body = "", sfId: string | null = null): ApexClassInput => ({ name, body, sfId, lineCount: body.split("\n").length });
const trig = (name: string, objectName: string, body: string, sfId: string | null = null): ApexTriggerInput => ({ name, objectName, body, sfId });
const index = new ObjectIndex([{ name: "Account" }, { name: "Invoice__c", sfId: "01I5g000000AbCdEAK" }]);

describe("stripNonCode", () => {
  it("blanks block comments, line comments and strings", () => {
    const out = stripNonCode("a /* Foo */ b // Bar\n c 'Baz' d");
    expect(out).not.toMatch(/Foo|Bar|Baz/);
    expect(out).toMatch(/a\s+b\s+c\s+d/);
  });

  it("does not let // inside a string start a comment", () => {
    expect(stripNonCode("x = 'http://a'; Keep y")).toContain("Keep");
  });

  it("does not let an apostrophe inside a comment open a string", () => {
    expect(stripNonCode("// don't\nKeep")).toContain("Keep");
  });

  it("honours escaped quotes inside strings", () => {
    expect(stripNonCode("'it\\'s Hidden' Keep")).not.toContain("Hidden");
  });

  it("separates tokens a comment sat between", () => {
    expect(referencedNames("foo/*x*/Bar", new Map([["bar", "k"]]))).toEqual(["bar"]);
    expect(referencedNames("foo/*x*/Bar", new Map([["foobar", "k"]]))).toEqual([]);
  });
});

describe("referencedNames", () => {
  const known = new Map([["helper", "k1"], ["other", "k2"]]);

  it("matches case-insensitively and returns each name once", () => {
    expect(referencedNames("HELPER.run(); helper.run(); Helper h;", known).sort()).toEqual(["helper"]);
  });

  it("excludes self", () => {
    expect(referencedNames("Helper h; Other o;", known, "helper")).toEqual(["other"]);
  });

  it("ignores names in comments and strings", () => {
    expect(referencedNames("// Helper\n String s = 'Other';", known)).toEqual([]);
  });

  it("skips member access and namespace-qualified names, even across whitespace", () => {
    expect(referencedNames("acct.Helper = 1; ns.Other o; x .\n Helper", known)).toEqual([]);
  });

  it("handles an empty body and an empty known set", () => {
    expect(referencedNames("", known)).toEqual([]);
    expect(referencedNames("Helper", new Map())).toEqual([]);
  });
});

describe("scanApexClasses", () => {
  it("emits nodes, Ids and heuristic REFERENCES between classes", () => {
    const out = scanApexClasses([cls("A", "B b = new B();", "01p000000000001AAA"), cls("B", "// A\nInteger i;"), cls("C", "")]);
    expect(out.nodes.map((n) => n.fqn)).toEqual(["A", "B", "C"]);
    expect(out.ids).toEqual([["01p000000000001AAA", keyOf("ApexClass", "A")]]);
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]).toMatchObject({ typeKey: "SalesforceMetadata.REFERENCES", confidence: "heuristic", sourceNodeKey: keyOf("ApexClass", "A"), targetNodeKey: keyOf("ApexClass", "B") });
  });

  it("emits one edge however many times a class is mentioned and none for a self reference", () => {
    const out = scanApexClasses([cls("A", "B.x(); B.y(); A.z(); B b;"), cls("B")]);
    expect(out.edges).toHaveLength(1);
  });

  it("handles no classes", () => {
    expect(scanApexClasses([])).toEqual({ nodes: [], edges: [], ids: [] });
  });

  it("scales to many classes that all reference one hub", () => {
    const classes = [cls("Hub"), ...Array.from({ length: 500 }, (_, i) => cls(`C${i}`, "Hub.run();"))];
    const out = scanApexClasses(classes);
    expect(out.nodes).toHaveLength(501);
    expect(out.edges).toHaveLength(500);
  });
});

describe("parseTriggerHeader", () => {
  it("parses object and events, normalising case and whitespace", () => {
    expect(parseTriggerHeader("trigger T on Account (Before   Insert, after update ,after delete) { }")).toEqual({
      objectName: "Account",
      events: ["before insert", "after update", "after delete"],
    });
  });

  it("parses a header that wraps lines and follows a comment", () => {
    expect(parseTriggerHeader("// trigger Fake on Wrong (before insert)\ntrigger\n T\n on\n Invoice__c\n(after insert) {}")).toEqual({ objectName: "Invoice__c", events: ["after insert"] });
  });

  it("drops invalid events and duplicates; returns null when there is no header", () => {
    expect(parseTriggerHeader("trigger T on Account (before insert, before insert, sometimes)")?.events).toEqual(["before insert"]);
    expect(parseTriggerHeader("public class NotATrigger {}")).toBeNull();
    expect(parseTriggerHeader("")).toBeNull();
  });
});

describe("scanApexTriggers", () => {
  const classes = [cls("Handler"), cls("Util")];

  it("emits EXECUTES_ON with parsed confidence and the declared events", () => {
    const out = scanApexTriggers([trig("T", "Account", "trigger T on Account (before insert) { Handler.run(); }")], classes, index);
    const executes = out.edges.find((e) => e.typeKey.endsWith("EXECUTES_ON"))!;
    expect(executes).toMatchObject({ confidence: "parsed", targetNodeKey: keyOf("CustomObject", "Account"), attributes: { triggerEvents: ["before insert"] } });
    expect(out.nodes[0].attributes).toEqual({ objectApiName: "Account", triggerEvents: ["before insert"] });
    expect(out.edges.filter((e) => e.typeKey.endsWith("REFERENCES"))).toHaveLength(1);
  });

  it("falls back to TableEnumOrId with exact confidence when the header does not parse", () => {
    const out = scanApexTriggers([trig("T", "Account", "garbage")], classes, index);
    expect(out.edges[0]).toMatchObject({ confidence: "exact", targetNodeKey: keyOf("CustomObject", "Account") });
  });

  it("resolves a custom object's Id from TableEnumOrId", () => {
    const out = scanApexTriggers([trig("T", "01I5g000000AbCdEAK", "garbage")], classes, index);
    expect(out.edges[0].targetNodeKey).toBe(keyOf("CustomObject", "Invoice__c"));
  });

  it("prefers the parsed object over a different TableEnumOrId", () => {
    const out = scanApexTriggers([trig("T", "Account", "trigger T on Invoice__c (before insert) {}")], classes, index);
    expect(out.edges[0].targetNodeKey).toBe(keyOf("CustomObject", "Invoice__c"));
  });

  it("emits no EXECUTES_ON for an out-of-scope object but still emits the node and references", () => {
    const out = scanApexTriggers([trig("T", "01I000000000000AAA", "trigger T on Evt__e (after insert) { Util.go(); }")], classes, index);
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0].attributes).toMatchObject({ objectApiName: null });
    expect(out.edges.map((e) => e.typeKey)).toEqual(["SalesforceMetadata.REFERENCES"]);
  });

  it("matches the header object case-insensitively", () => {
    const out = scanApexTriggers([trig("T", "x", "trigger T on ACCOUNT (before insert) {}")], classes, index);
    expect(out.edges[0].targetNodeKey).toBe(keyOf("CustomObject", "Account"));
  });

  it("builds the class index case-insensitively", () => {
    expect(classKeyIndex([cls("MyClass")]).get("myclass")).toBe(keyOf("ApexClass", "MyClass"));
  });
});
