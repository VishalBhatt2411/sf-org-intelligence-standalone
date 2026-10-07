import type { ApexClass, ApexTrigger } from "@prisma/client";
import type { NewFinding } from "./codeQuality";
import { findInLoop } from "./codeQuality";

// Thresholds sourced from Salesforce's own Apex Governor Limits cheatsheet:
// https://developer.salesforce.com/docs/atlas.en-us.salesforce_app_limits_cheatsheet.meta/salesforce_app_limits_cheatsheet/salesforce_app_limits_platform_apexgov.htm
const CALLOUT_RE = /\b(new\s+HttpRequest|Http\s*\(\s*\)\s*\.\s*send|WebServiceCallout\s*\.\s*invoke)\b/;
const EMAIL_SEND_RE = /\bMessaging\s*\.\s*sendEmail\b/;
const SOQL_COUNT_RE = /\[\s*SELECT\b/gi;
const DML_COUNT_RE = /\b(insert|update|delete|upsert|merge)\s+[\w[\]]/gi;

// Per-transaction limits are 100 SOQL / 150 DML statements — these per-class counts are a
// proxy (can't know transaction boundaries statically), not a direct measurement.
const SOQL_PER_CLASS_THRESHOLD = 20;
const DML_PER_CLASS_THRESHOLD = 30;

// These two are real static org-wide limits, computed exactly from scanned source size.
const ORG_APEX_CODE_LIMIT_CHARS = 6_000_000; // "Maximum amount of code used by all Apex code in an org"
const ORG_APEX_CODE_WARN_RATIO = 0.7;
const CLASS_CHAR_LIMIT = 1_000_000; // "Maximum number of characters for a class/trigger"
const CLASS_CHAR_WARN_RATIO = 0.9;
const DEPLOYMENT_UNIT_LIMIT = 7500; // "Maximum number of class and trigger code units in a deployment"
const DEPLOYMENT_UNIT_WARN_RATIO = 0.5;

export function analyzeGovernorLimits(classes: ApexClass[], triggers: ApexTrigger[]): NewFinding[] {
  const findings: NewFinding[] = [];
  const bodies = [
    ...classes.map((c) => ({ componentType: "ApexClass", name: c.name, body: c.body })),
    ...triggers.map((t) => ({ componentType: "ApexTrigger", name: t.name, body: t.body })),
  ];

  for (const { componentType, name, body } of bodies) {
    if (findInLoop(body, CALLOUT_RE)) {
      findings.push({
        category: "governor_limits",
        ruleKey: "callout_in_loop",
        severity: "high",
        title: `Callout inside a loop in ${name}`,
        detail: "A callout per loop iteration can quickly exceed the 100-callouts-per-transaction limit; bulkify with a single batched call instead.",
        componentType,
        componentName: name,
      });
    }

    if (findInLoop(body, EMAIL_SEND_RE)) {
      findings.push({
        category: "governor_limits",
        ruleKey: "email_in_loop",
        severity: "medium",
        title: `Messaging.sendEmail inside a loop in ${name}`,
        detail: "Only 10 sendEmail calls are allowed per transaction; sending one per record in a loop will hit that limit on any batch of more than 10.",
        componentType,
        componentName: name,
      });
    }

    const soqlCount = (body.match(SOQL_COUNT_RE) || []).length;
    if (soqlCount > SOQL_PER_CLASS_THRESHOLD) {
      findings.push({
        category: "governor_limits",
        ruleKey: "soql_heavy_class",
        severity: "medium",
        title: `${name} issues ${soqlCount} SOQL queries`,
        detail: "A transaction can issue at most 100 (sync) / 200 (async) SOQL queries total; a single class with this many statements leaves little headroom for anything else called in the same transaction.",
        componentType,
        componentName: name,
      });
    }

    const dmlCount = (body.match(DML_COUNT_RE) || []).length;
    if (dmlCount > DML_PER_CLASS_THRESHOLD) {
      findings.push({
        category: "governor_limits",
        ruleKey: "dml_heavy_class",
        severity: "medium",
        title: `${name} issues ${dmlCount} DML statements`,
        detail: "A transaction can issue at most 150 DML statements total; a single class with this many leaves little headroom for anything else called in the same transaction.",
        componentType,
        componentName: name,
      });
    }

    if (body.length > CLASS_CHAR_LIMIT * CLASS_CHAR_WARN_RATIO) {
      findings.push({
        category: "governor_limits",
        ruleKey: "class_near_char_limit",
        severity: "high",
        title: `${name} is approaching the per-class character limit`,
        detail: `${body.length.toLocaleString()} characters, against Salesforce's hard limit of ${CLASS_CHAR_LIMIT.toLocaleString()} per class/trigger.`,
        componentType,
        componentName: name,
      });
    }
  }

  const totalChars = bodies.reduce((sum, b) => sum + b.body.length, 0);
  if (totalChars > ORG_APEX_CODE_LIMIT_CHARS * ORG_APEX_CODE_WARN_RATIO) {
    findings.push({
      category: "governor_limits",
      ruleKey: "org_apex_code_size",
      severity: "medium",
      title: "Org's total Apex code size is approaching the platform limit",
      detail: `Scanned classes + triggers total ${totalChars.toLocaleString()} characters, against Salesforce's org-wide limit of ${ORG_APEX_CODE_LIMIT_CHARS.toLocaleString()} (6 MB).`,
      componentType: "Organization",
      componentName: "Apex Code",
    });
  }

  const totalUnits = classes.length + triggers.length;
  if (totalUnits > DEPLOYMENT_UNIT_LIMIT * DEPLOYMENT_UNIT_WARN_RATIO) {
    findings.push({
      category: "governor_limits",
      ruleKey: "org_apex_unit_count",
      severity: "low",
      title: "High number of Apex classes/triggers",
      detail: `${totalUnits} class/trigger units scanned, against Salesforce's deployment limit of ${DEPLOYMENT_UNIT_LIMIT} per deployment.`,
      componentType: "Organization",
      componentName: "Apex Code",
    });
  }

  return findings;
}
