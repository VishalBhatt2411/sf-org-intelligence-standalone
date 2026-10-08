import { randomUUID } from "node:crypto";
import type { FindingSection } from "../types";
import type { FindingEvent, FindingRepository, FindingRow, FindingUpdate, NewFinding, NewFindingEvent, StoredFinding, SyncView } from "./findingTypes";

const toRow = (f: StoredFinding): FindingRow => ({
  id: f.id,
  section: f.section,
  ruleKey: f.ruleKey,
  componentKey: f.componentKey,
  componentType: f.componentType,
  componentLabel: f.componentLabel,
  title: f.title,
  severity: f.severity,
  confidence: f.confidence,
  score: f.score,
  status: f.status,
  measured: f.measured,
  expected: f.expected,
  owner: f.owner,
  dueDate: f.dueDate,
  riskAcceptanceExpiry: f.riskAcceptanceExpiry,
  firstDetectedAt: f.firstDetectedAt,
  lastDetectedAt: f.lastDetectedAt,
  resolvedAt: f.resolvedAt,
});

// Test double with the same behaviour as the Prisma implementation. Nothing in production imports it.
export class InMemoryFindingRepository implements FindingRepository {
  findings = new Map<string, StoredFinding>();
  allEvents: FindingEvent[] = [];
  clock: () => Date = () => new Date();

  private of(connectionId: string) {
    return [...this.findings.values()].filter((f) => f.connectionId === connectionId);
  }

  async syncView(connectionId: string, section: FindingSection): Promise<SyncView[]> {
    return this.of(connectionId)
      .filter((f) => f.section === section)
      .map(({ id, fingerprint, status, resolvedAt }) => ({ id, fingerprint, status, resolvedAt }));
  }

  async insertMany(connectionId: string, findings: NewFinding[]): Promise<void> {
    for (const n of findings) {
      const { fingerprint, lastRunId, detectedAt, ...candidate } = n;
      if (this.of(connectionId).some((f) => f.fingerprint === fingerprint)) throw new Error("duplicate fingerprint");
      const id = randomUUID();
      this.findings.set(id, {
        ...candidate,
        id,
        connectionId,
        fingerprint,
        status: "open",
        owner: null,
        dueDate: null,
        notes: null,
        compensatingControl: null,
        riskAcceptanceExpiry: null,
        falsePositiveReason: null,
        firstDetectedAt: detectedAt,
        lastDetectedAt: detectedAt,
        resolvedAt: null,
        lastRunId,
        updatedAt: detectedAt,
      });
    }
  }

  async update(connectionId: string, id: string, data: FindingUpdate): Promise<StoredFinding | null> {
    const current = this.findings.get(id);
    if (!current || current.connectionId !== connectionId) return null;
    const next = { ...current, ...data, updatedAt: this.clock() };
    this.findings.set(id, next);
    return next;
  }

  async resolveMany(connectionId: string, ids: string[], resolvedAt: Date, runId: string | null): Promise<void> {
    for (const id of ids) await this.update(connectionId, id, { status: "resolved", resolvedAt, lastRunId: runId });
  }

  async addEvents(events: NewFindingEvent[]): Promise<void> {
    for (const e of events) this.allEvents.push({ ...e, id: randomUUID() });
  }

  async get(connectionId: string, id: string): Promise<StoredFinding | null> {
    const f = this.findings.get(id);
    return f && f.connectionId === connectionId ? f : null;
  }

  async rows(connectionId: string, sections?: FindingSection[]): Promise<FindingRow[]> {
    return this.of(connectionId)
      .filter((f) => !sections || sections.includes(f.section))
      .map(toRow);
  }

  async byComponent(connectionId: string, componentKey: string): Promise<FindingRow[]> {
    return this.of(connectionId)
      .filter((f) => f.componentKey === componentKey)
      .map(toRow);
  }

  async events(connectionId: string, findingId: string, limit: number): Promise<FindingEvent[]> {
    if (!(await this.get(connectionId, findingId))) return [];
    return this.allEvents
      .filter((e) => e.findingId === findingId)
      .sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime())
      .slice(0, limit);
  }
}
