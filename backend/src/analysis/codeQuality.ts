import type { ApexClass, ApexTrigger } from "@prisma/client";

export type NewFinding = {
  category: string;
  ruleKey: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  detail: string;
  componentType: string;
  componentName: string;
};

const HARDCODED_ID_RE = /'[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?'/g;
const DML_KEYWORDS = /\b(insert|update|delete|upsert|merge)\s+[\w[\]]/gi;
const LARGE_CLASS_LINES = 500;
const HIGH_COMPLEXITY_KEYWORD_COUNT = 30;

const EMPTY_CATCH_RE = /catch\s*\([^)]*\)\s*\{\s*\}/g;
const SHARING_KEYWORD_RE = /\b(with|without|inherited)\s+sharing\b/i;
const ANY_SOQL_OR_DML_RE = /(\[\s*SELECT\b|\b(insert|update|delete|upsert|merge)\s+[\w[\]])/i;
const DEBUG_STATEMENT_RE = /System\s*\.\s*debug\s*\(/g;
const TODO_FIXME_RE = /\/\/\s*(TODO|FIXME)\b/gi;

// ponytail: brace-depth heuristic, not a real AST — flags likely SOQL/DML-in-loop, not proven.
export function findInLoop(body: string, targetRe: RegExp): boolean {
  let depth = 0;
  let loopDepth: number | null = null;
  for (const line of body.split("\n")) {
    if (/\b(for|while)\s*\(/.test(line)) {
      if (loopDepth === null) loopDepth = depth;
    }
    if (loopDepth !== null && targetRe.test(line)) return true;
    depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
    if (loopDepth !== null && depth <= loopDepth) loopDepth = null;
  }
  return false;
}

function analyzeBody(componentType: string, name: string, body: string, lineCount: number): NewFinding[] {
  const findings: NewFinding[] = [];

  if (findInLoop(body, /\[\s*SELECT/i)) {
    findings.push({
      category: "code_quality",
      ruleKey: "soql_in_loop",
      severity: "high",
      title: `SOQL query inside a loop in ${name}`,
      detail: "Querying inside a loop risks hitting governor limits as data volume grows.",
      componentType,
      componentName: name,
    });
  }

  if (findInLoop(body, DML_KEYWORDS)) {
    findings.push({
      category: "code_quality",
      ruleKey: "dml_in_loop",
      severity: "high",
      title: `DML statement inside a loop in ${name}`,
      detail: "Performing DML inside a loop risks hitting governor limits; bulkify with collections instead.",
      componentType,
      componentName: name,
    });
  }

  const hardcodedIds = body.match(HARDCODED_ID_RE);
  if (hardcodedIds && hardcodedIds.length > 0) {
    findings.push({
      category: "code_quality",
      ruleKey: "hardcoded_id",
      severity: "medium",
      title: `Hardcoded Salesforce ID(s) in ${name}`,
      detail: `Found ${hardcodedIds.length} literal ID(s), which break across sandboxes/orgs.`,
      componentType,
      componentName: name,
    });
  }

  if (lineCount > LARGE_CLASS_LINES) {
    findings.push({
      category: "code_quality",
      ruleKey: "large_class",
      severity: "medium",
      title: `${name} is a large class (${lineCount} lines)`,
      detail: `Exceeds ${LARGE_CLASS_LINES} lines, making it harder to test and maintain.`,
      componentType,
      componentName: name,
    });
  }

  const complexityKeywordCount = (body.match(/\b(if|for|while|switch|case)\s*[\(:]/g) || []).length;
  if (complexityKeywordCount > HIGH_COMPLEXITY_KEYWORD_COUNT) {
    findings.push({
      category: "code_quality",
      ruleKey: "high_complexity",
      severity: "medium",
      title: `${name} has high branching complexity`,
      detail: `${complexityKeywordCount} branch/loop keywords found; consider splitting into smaller methods.`,
      componentType,
      componentName: name,
    });
  }

  const emptyCatches = body.match(EMPTY_CATCH_RE);
  if (emptyCatches) {
    findings.push({
      category: "code_quality",
      ruleKey: "empty_catch_block",
      severity: "high",
      title: `${name} has an empty catch block`,
      detail: `Found ${emptyCatches.length} catch block(s) with no logging or rethrow; failures are silently swallowed instead of surfacing.`,
      componentType,
      componentName: name,
    });
  }

  if (componentType === "ApexClass" && ANY_SOQL_OR_DML_RE.test(body) && !SHARING_KEYWORD_RE.test(body)) {
    findings.push({
      category: "code_quality",
      ruleKey: "missing_sharing_declaration",
      severity: "medium",
      title: `${name} has no sharing declaration`,
      detail: "Reads or writes data without declaring with/without/inherited sharing, leaving its record-access posture implicit and easy to get wrong during review.",
      componentType,
      componentName: name,
    });
  }

  const debugStatements = body.match(DEBUG_STATEMENT_RE);
  if (debugStatements) {
    findings.push({
      category: "code_quality",
      ruleKey: "debug_statement_left_in",
      severity: "low",
      title: `${name} contains System.debug statements`,
      detail: `${debugStatements.length} System.debug call(s) found; these cost performance and should be removed or replaced with proper logging before production.`,
      componentType,
      componentName: name,
    });
  }

  const todoMarkers = body.match(TODO_FIXME_RE);
  if (todoMarkers) {
    findings.push({
      category: "code_quality",
      ruleKey: "todo_fixme_marker",
      severity: "low",
      title: `${name} has unresolved TODO/FIXME comments`,
      detail: `${todoMarkers.length} marker(s) found — tracked technical debt left in the code.`,
      componentType,
      componentName: name,
    });
  }

  return findings;
}

function checkTriggerNaming(trigger: ApexTrigger): NewFinding[] {
  const escapedObjectName = trigger.objectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expectedPattern = new RegExp(`^${escapedObjectName}.*Trigger$`, "i");
  if (expectedPattern.test(trigger.name)) return [];

  return [
    {
      category: "code_quality",
      ruleKey: "trigger_naming_convention",
      severity: "low",
      title: `${trigger.name} doesn't follow the <ObjectName>Trigger naming convention`,
      detail: `Expected a name referencing "${trigger.objectName}" and ending in "Trigger" (e.g. ${trigger.objectName}Trigger) for discoverability.`,
      componentType: "ApexTrigger",
      componentName: trigger.name,
    },
  ];
}

export function analyzeCodeQuality(classes: ApexClass[], triggers: ApexTrigger[]): NewFinding[] {
  return [
    ...classes.flatMap((c) => analyzeBody("ApexClass", c.name, c.body, c.lineCount)),
    ...triggers.flatMap((t) => analyzeBody("ApexTrigger", t.name, t.body, t.body.split("\n").length)),
    ...triggers.flatMap(checkTriggerNaming),
  ];
}
