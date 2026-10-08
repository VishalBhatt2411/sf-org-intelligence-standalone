import type { FindingCandidate } from "../types";

// Candidate builder for the findings tests. Nothing in production imports this.
export const candidate = (over: Partial<FindingCandidate> = {}): FindingCandidate => ({
  section: "code",
  ruleKey: "CodeHealth.HighDependency",
  ruleVersion: 1,
  componentKey: "k1",
  componentType: "Apex Class",
  componentLabel: "Billing",
  title: "Billing has too many dependencies",
  severity: "warning",
  confidence: "medium",
  score: 50,
  evidence: "Billing has 30 dependencies.",
  measured: "30",
  expected: "< 20",
  explanation: "why",
  risk: "risk",
  impact: "impact",
  remediation: "split it",
  validation: "re-run",
  contributors: [],
  ...over,
});
