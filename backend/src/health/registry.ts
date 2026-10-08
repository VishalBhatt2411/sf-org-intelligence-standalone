import { GOOD_FROM, WARNING_FROM, type HealthConfig } from "./config";
import type { FindingSection, Severity } from "./types";

// The severity registry: what Good / Warning / Critical mean, and every rule that can raise a finding,
// with the threshold currently in force. It is read from the config so it can never drift from the rules.

export type SeverityBand = { severity: Severity; label: string; range: string; meaning: string };
export type RegistryRule = { ruleKey: string; section: FindingSection; title: string; threshold: string };

export function severityRegistry(config: HealthConfig): { bands: SeverityBand[]; rules: RegistryRule[] } {
  const m = config.metadata;
  const c = config.code;
  const s = config.security;
  const d = config.data;
  return {
    bands: [
      { severity: "good", label: "Good", range: `${GOOD_FROM} to 100`, meaning: "Nothing needs attention." },
      { severity: "warning", label: "Warning", range: `${WARNING_FROM} to below ${GOOD_FROM}`, meaning: "Worth planning for; not urgent." },
      { severity: "critical", label: "Critical", range: `below ${WARNING_FROM}`, meaning: "Should be looked at first." },
    ],
    rules: [
      { ruleKey: "MetadataHealth.HighFieldCount", section: "metadata", title: "Object with many custom fields", threshold: `${m.fieldThreshold} or more custom fields` },
      { ruleKey: "MetadataHealth.HighDegree", section: "metadata", title: "Object with many incoming relationships", threshold: `${m.degreeThreshold} or more incoming relationships` },
      { ruleKey: "MetadataHealth.NoIncomingReferences", section: "metadata", title: "Object nothing refers to", threshold: "No incoming reference detected" },
      { ruleKey: "AutomationHealth.HighDependency", section: "automation", title: "Automation with high fan-in/fan-out", threshold: `${config.automation.dependencyThreshold} or more components in and out combined` },
      { ruleKey: "AutomationHealth.DependencyCycle", section: "automation", title: "Automation in a dependency cycle", threshold: "Part of a circular dependency" },
      { ruleKey: "CodeHealth.HighDependency", section: "code", title: "Apex class with high fan-in/fan-out", threshold: `${c.dependencyThreshold} or more components in and out combined` },
      { ruleKey: "CodeHealth.OldApiVersion", section: "code", title: "Apex class on an old API version", threshold: `Below API version ${c.apiVersionThreshold}` },
      { ruleKey: "CodeHealth.DependencyCycle", section: "code", title: "Apex class in a dependency cycle", threshold: "Part of a circular dependency" },
      { ruleKey: "SecurityHealth.ElevatedPermissions", section: "security", title: "Powerful system permissions", threshold: `${s.threshold} weighted permission points` },
      { ruleKey: "SecurityHealth.BroadObjectGrant", section: "security", title: "View All / Modify All on many objects", threshold: `${s.broadObjectThreshold} or more objects` },
      { ruleKey: "SecurityHealth.SensitiveObjectGrant", section: "security", title: "Broad access to sensitive objects", threshold: `View All, Modify All or Delete on ${s.sensitiveObjects.join(", ")}` },
      { ruleKey: "DataHealth.StaleRecords", section: "data", title: "Stale records", threshold: `${d.staleThresholdPercent}% or more not changed in ${d.staleDays} days` },
      { ruleKey: "DataHealth.Completeness", section: "data", title: "Incomplete records", threshold: `${d.incompleteThresholdPercent}% or more missing a key field (sampled)` },
      { ruleKey: "DataHealth.Duplicates", section: "data", title: "Duplicate records", threshold: `${d.duplicateThresholdPercent}% or more exact duplicates (sampled)` },
    ],
  };
}
