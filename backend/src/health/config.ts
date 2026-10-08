import type { SectionKey } from "./types";

// Every threshold, weight and ceiling of Org Health in one place. Services receive a HealthConfig rather
// than reading constants, so a per-org override can be added later without touching the rules.
export type HealthConfig = {
  metadata: { fieldThreshold: number; fieldWeight: number; degreeThreshold: number; degreeWeight: number; orphanWeight: number };
  code: { dependencyThreshold: number; dependencyWeight: number; apiVersionThreshold: number; apiVersionWeight: number };
  automation: { dependencyThreshold: number };
  security: { threshold: number; broadObjectThreshold: number; sensitiveObjects: string[] };
  data: {
    staleThresholdPercent: number;
    incompleteThresholdPercent: number;
    duplicateThresholdPercent: number;
    staleWeight: number;
    completenessWeight: number;
    duplicatesWeight: number;
    objects: string[];
    // Per object: the fields whose absence makes a record "incomplete", and the fields that must all match
    // for two records to count as duplicates. A field the org does not have is skipped and reported.
    completenessFields: Record<string, string[]>;
    duplicateKeys: Record<string, string[]>;
    sampleCeiling: number;
    staleDays: number;
  };
  // Most rows a section reads from the graph or from Salesforce; reaching it is reported as partial coverage.
  ceiling: number;
  objectCeiling: number;
};

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  metadata: { fieldThreshold: 60, fieldWeight: 35, degreeThreshold: 25, degreeWeight: 35, orphanWeight: 30 },
  // apiVersionThreshold: a class below this API version is stale (55 is the original's default).
  code: { dependencyThreshold: 20, dependencyWeight: 55, apiVersionThreshold: 55, apiVersionWeight: 45 },
  automation: { dependencyThreshold: 10 },
  // threshold: weighted elevated-permission points at which that signal reaches full strength.
  // broadObjectThreshold: objects with View/Modify All at which the broad-grant signal is at full strength.
  security: { threshold: 1, broadObjectThreshold: 5, sensitiveObjects: ["User", "Contact", "Lead", "Case"] },
  data: {
    staleThresholdPercent: 15,
    incompleteThresholdPercent: 10,
    duplicateThresholdPercent: 5,
    staleWeight: 35,
    completenessWeight: 35,
    duplicatesWeight: 30,
    objects: ["Account", "Case", "Contact", "Lead", "Opportunity"],
    completenessFields: {
      Account: ["Industry", "Phone", "BillingCountry"],
      Case: ["ContactId", "AccountId", "Origin"],
      Contact: ["Email", "Phone", "AccountId"],
      Lead: ["Email", "Phone", "LeadSource"],
      Opportunity: ["Amount", "AccountId", "LeadSource"],
    },
    duplicateKeys: { Account: ["Name"], Contact: ["Email"], Lead: ["Email"], Opportunity: ["Name", "AccountId"] },
    sampleCeiling: 200,
    staleDays: 180,
  },
  ceiling: 500,
  objectCeiling: 1000,
};

// Scoring constants shared by every signal.
export const PRIMARY_SIGNAL_WEIGHT = 90;
export const CYCLE_SIGNAL_WEIGHT = 45;
export const NO_REFERENCES_SIGNAL_WEIGHT = 45;
// A magnitude above this adds nothing more; one wildly bad number must not dominate the score.
export const MAGNITUDE_CAP = 1.5;
// How many versions behind the threshold counts as a full-strength signal.
export const API_VERSION_MARGIN = 5;
export const RATE_SIGNAL_CONFIDENCE = 0.7;

// Severity bands on the health value (100 - badness); half-open, so exactly 70 is Good.
export const GOOD_FROM = 70;
export const WARNING_FROM = 40;

export type SectionInfo = { key: SectionKey; label: string; scored: boolean; live: boolean; order: number; blurb: string };

export const SECTIONS: SectionInfo[] = [
  { key: "overview", label: "Overview", scored: false, live: false, order: 1, blurb: "What the last scan found, at a glance." },
  { key: "metadata", label: "Metadata", scored: true, live: false, order: 2, blurb: "Objects, fields and how tightly they are connected." },
  { key: "automation", label: "Automation", scored: false, live: false, order: 3, blurb: "Triggers and flows, and what they depend on." },
  { key: "code", label: "Code", scored: true, live: false, order: 4, blurb: "Apex classes: dependencies, cycles and API age." },
  { key: "security", label: "Security", scored: false, live: true, order: 5, blurb: "Powerful permissions, read live from Salesforce." },
  { key: "data", label: "Data", scored: true, live: true, order: 6, blurb: "Stale, incomplete and duplicate records in a sample of key objects." },
  { key: "storage", label: "Storage", scored: false, live: true, order: 7, blurb: "Data and file storage used, from Salesforce limits." },
];

export const sectionInfo = (key: SectionKey): SectionInfo => SECTIONS.find((s) => s.key === key)!;
export const sectionLabel = (key: string): string => SECTIONS.find((s) => s.key === key)?.label ?? key;
