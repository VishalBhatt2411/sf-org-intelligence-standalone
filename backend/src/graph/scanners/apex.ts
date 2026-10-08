import { dedupeEdges, edgeDraft, keyOf, nodeDraft } from "../draft";
import type { ObjectIndex } from "../objectIndex";
import { emptyOutput, type ScannerOutput } from "../types";
import type { ApexClassInput, ApexTriggerInput } from "./inputs";

// Comments and string literals are blanked before tokenising, in one alternation so whichever
// construct opens first is consumed first. That ordering is what keeps "http://x" (a // inside a
// string) from starting a comment and "don't" (an apostrophe inside a comment) from opening a string.
// Apex has no character, raw-string or regex literals, so these three cases are exhaustive.
const NON_CODE_REGION = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\])*'/g;
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;
const TRIGGER_HEADER = /\btrigger\s+[A-Za-z0-9_]+\s+on\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/i;
const TRIGGER_EVENT = /^(before|after)\s+(insert|update|delete|undelete)$/;

// Each region becomes a space, not nothing, so `foo/*x*/bar` cannot fuse into one token.
export function stripNonCode(body: string): string {
  return body.replace(NON_CODE_REGION, " ");
}

// Distinct identifiers of the body that name a known class, other than `self`. Matching is
// case-insensitive because Apex is. A token preceded by "." is a member access or a namespace-
// qualified name (`obj.Billing`, `ns.Billing`), not a reference to the local class of that name, so
// it is skipped.
export function referencedNames(body: string, known: ReadonlyMap<string, string>, self?: string): string[] {
  const code = stripNonCode(body);
  const found = new Set<string>();
  for (const match of code.matchAll(IDENTIFIER)) {
    const lower = match[0].toLowerCase();
    if (!known.has(lower) || lower === self?.toLowerCase()) continue;
    let i = (match.index ?? 0) - 1;
    while (i >= 0 && /\s/.test(code[i])) i--;
    if (i >= 0 && code[i] === ".") continue;
    found.add(lower);
  }
  return [...found];
}

// lower-cased class name -> node key, the lookup both scanners use to turn a token into an edge target.
export function classKeyIndex(classes: ApexClassInput[]): Map<string, string> {
  return new Map(classes.map((c) => [c.name.toLowerCase(), keyOf("ApexClass", c.name)]));
}

// Classes: one node each, plus a REFERENCES edge to every other class named in the (comment- and
// string-free) body. The edge is a heuristic: dynamic Apex (Type.forName) and interface
// indirection are invisible to a name match, which is why it carries "heuristic" confidence and the
// precise class-to-class dependency comes from the dependency stage instead.
export function scanApexClasses(classes: ApexClassInput[]): ScannerOutput {
  const out = emptyOutput();
  const known = classKeyIndex(classes);
  for (const apexClass of classes) {
    const { key, draft } = nodeDraft("ApexClass", {
      fqn: apexClass.name,
      label: apexClass.name,
      attributes: { lineCount: apexClass.lineCount, apiVersion: apexClass.apiVersion ?? null },
    });
    out.nodes.push(draft);
    if (apexClass.sfId) out.ids.push([apexClass.sfId, key]);
    for (const name of referencedNames(apexClass.body, known, apexClass.name)) {
      out.edges.push(edgeDraft("REFERENCES", key, known.get(name)!));
    }
  }
  out.edges = dedupeEdges(out.edges);
  return out;
}

export type TriggerHeader = { objectName: string; events: string[] };

// `trigger Foo on Account (before insert, after update)`. Returns null when the declaration does not
// parse. Events that are not one of the seven valid combinations are dropped.
export function parseTriggerHeader(body: string): TriggerHeader | null {
  const match = TRIGGER_HEADER.exec(stripNonCode(body));
  if (!match) return null;
  const events = match[2]
    .split(",")
    .map((e) => e.trim().toLowerCase().replace(/\s+/g, " "))
    .filter((e) => TRIGGER_EVENT.test(e));
  return { objectName: match[1], events: [...new Set(events)] };
}

// Triggers: one node each; EXECUTES_ON the object they fire on, and REFERENCES to the classes they
// call. The object comes from the declaration in the body ("parsed" confidence) and falls back to
// TableEnumOrId ("exact": it is the platform's own record of the object). A trigger whose object is
// not an in-scope object (a Platform Event trigger, say) gets no EXECUTES_ON edge rather than a guess.
export function scanApexTriggers(triggers: ApexTriggerInput[], classes: ApexClassInput[], index: ObjectIndex): ScannerOutput {
  const out = emptyOutput();
  const known = classKeyIndex(classes);
  for (const trigger of triggers) {
    const header = parseTriggerHeader(trigger.body);
    const parsed = header ? index.resolve(header.objectName) : null;
    const target = parsed ?? index.resolve(trigger.objectName);
    const events = header?.events ?? [];

    const { key, draft } = nodeDraft("ApexTrigger", {
      fqn: trigger.name,
      label: trigger.name,
      attributes: { objectApiName: target?.name ?? null, triggerEvents: events },
    });
    out.nodes.push(draft);
    if (trigger.sfId) out.ids.push([trigger.sfId, key]);

    if (target) {
      out.edges.push(edgeDraft("EXECUTES_ON", key, target.nodeKey, { confidence: parsed ? "parsed" : "exact", attributes: { triggerEvents: events } }));
    }
    for (const name of referencedNames(trigger.body, known)) {
      out.edges.push(edgeDraft("REFERENCES", key, known.get(name)!));
    }
  }
  out.edges = dedupeEdges(out.edges);
  return out;
}
