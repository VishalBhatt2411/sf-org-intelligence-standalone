import { createHash } from "node:crypto";
import type { Contributor, FindingCandidate, FindingSection, FindingStatus } from "../types";

// A stored finding: what a section proposed plus the triage state people add on top. Only the detection
// fields are ever rewritten by a sync; the triage fields belong to the people working the finding.

export type TriageFields = {
  status: FindingStatus;
  owner: string | null;
  dueDate: Date | null;
  notes: string | null;
  compensatingControl: string | null;
  riskAcceptanceExpiry: Date | null;
  falsePositiveReason: string | null;
};

export type StoredFinding = FindingCandidate &
  TriageFields & {
    id: string;
    connectionId: string;
    fingerprint: string;
    firstDetectedAt: Date;
    lastDetectedAt: Date;
    resolvedAt: Date | null;
    lastRunId: string | null;
    updatedAt: Date;
  };

// The columns a list needs; the long explanatory text stays out so a page of rows stays small.
export type FindingRow = Pick<
  StoredFinding,
  | "id"
  | "section"
  | "ruleKey"
  | "componentKey"
  | "componentType"
  | "componentLabel"
  | "title"
  | "severity"
  | "confidence"
  | "score"
  | "status"
  | "measured"
  | "expected"
  | "owner"
  | "dueDate"
  | "riskAcceptanceExpiry"
  | "firstDetectedAt"
  | "lastDetectedAt"
  | "resolvedAt"
>;

// What a sync needs to decide each finding's fate.
export type SyncView = Pick<StoredFinding, "id" | "fingerprint" | "status" | "resolvedAt">;

export type NewFinding = FindingCandidate & { fingerprint: string; lastRunId: string | null; detectedAt: Date };

// Fields a sync or a triage may change on an existing finding.
export type FindingUpdate = Partial<Omit<StoredFinding, "id" | "connectionId" | "fingerprint" | "updatedAt" | "firstDetectedAt">>;

export type FindingEvent = { id: string; findingId: string; field: string; oldValue: string | null; newValue: string | null; changedBy: string; changedAt: Date };
export type NewFindingEvent = Omit<FindingEvent, "id">;

export interface FindingRepository {
  syncView(connectionId: string, section: FindingSection): Promise<SyncView[]>;
  insertMany(connectionId: string, findings: NewFinding[]): Promise<void>;
  update(connectionId: string, id: string, data: FindingUpdate): Promise<StoredFinding | null>;
  // Mark many findings resolved in one write.
  resolveMany(connectionId: string, ids: string[], resolvedAt: Date, runId: string | null): Promise<void>;
  addEvents(events: NewFindingEvent[]): Promise<void>;
  get(connectionId: string, id: string): Promise<StoredFinding | null>;
  rows(connectionId: string, sections?: FindingSection[]): Promise<FindingRow[]>;
  byComponent(connectionId: string, componentKey: string): Promise<FindingRow[]>;
  events(connectionId: string, findingId: string, limit: number): Promise<FindingEvent[]>;
}

export const SYSTEM_ACTOR = "system";

export const fingerprintOf = (section: string, ruleKey: string, componentKey: string): string => createHash("sha256").update(`${section}::${ruleKey}::${componentKey}`).digest("hex");

// Statuses where nobody needs to act any more.
export const CLOSED_STATUSES: readonly FindingStatus[] = ["resolved", "false_positive"];

export const isRiskAcceptanceExpired = (f: Pick<StoredFinding, "status" | "riskAcceptanceExpiry">, now: Date): boolean =>
  f.status === "risk_accepted" && f.riskAcceptanceExpiry !== null && f.riskAcceptanceExpiry.getTime() < now.getTime();

// Past its due date and still waiting on someone; an accepted risk or a closed finding is not overdue.
export const isOverdue = (f: Pick<StoredFinding, "status" | "dueDate">, now: Date): boolean =>
  f.dueDate !== null && f.dueDate.getTime() < now.getTime() && !CLOSED_STATUSES.includes(f.status) && f.status !== "risk_accepted";

export const asContributors = (value: unknown): Contributor[] => (Array.isArray(value) ? (value as Contributor[]) : []);
