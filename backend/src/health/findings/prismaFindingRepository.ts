import type { Prisma, PrismaClient } from "@prisma/client";
import { chunked } from "../../graph/graphRepository";
import { isFindingStatus, type FindingConfidence, type FindingSection, type Severity } from "../types";
import { asContributors, type FindingEvent, type FindingRepository, type FindingRow, type FindingUpdate, type NewFinding, type NewFindingEvent, type StoredFinding, type SyncView } from "./findingTypes";

const ROW_SELECT = {
  id: true,
  section: true,
  ruleKey: true,
  componentKey: true,
  componentType: true,
  componentLabel: true,
  title: true,
  severity: true,
  confidence: true,
  score: true,
  status: true,
  measured: true,
  expected: true,
  owner: true,
  dueDate: true,
  riskAcceptanceExpiry: true,
  firstDetectedAt: true,
  lastDetectedAt: true,
  resolvedAt: true,
} as const;

type RowRecord = Prisma.OrgHealthFindingGetPayload<{ select: typeof ROW_SELECT }>;

const asSeverity = (v: string): Severity => (v === "critical" || v === "warning" ? v : "good");
const asConfidence = (v: string): FindingConfidence => (v === "high" || v === "medium" ? v : "low");
const asStatus = (v: string) => (isFindingStatus(v) ? v : "open");

const toRow = (r: RowRecord): FindingRow => ({
  ...r,
  section: r.section as FindingSection,
  severity: asSeverity(r.severity),
  confidence: asConfidence(r.confidence),
  status: asStatus(r.status),
});

const toStored = (r: Prisma.OrgHealthFindingGetPayload<object>): StoredFinding => ({
  ...r,
  section: r.section as FindingSection,
  severity: asSeverity(r.severity),
  confidence: asConfidence(r.confidence),
  status: asStatus(r.status),
  contributors: asContributors(r.contributors),
});

// Detection fields refreshed by a sync, as column values.
const data = (u: FindingUpdate): Prisma.OrgHealthFindingUncheckedUpdateInput => {
  const { contributors, section, severity, confidence, status, ...rest } = u;
  return { ...rest, ...(section ? { section } : {}), ...(severity ? { severity } : {}), ...(confidence ? { confidence } : {}), ...(status ? { status } : {}), ...(contributors ? { contributors: contributors as unknown as Prisma.InputJsonValue } : {}) };
};

export class PrismaFindingRepository implements FindingRepository {
  constructor(private readonly db: PrismaClient) {}

  async syncView(connectionId: string, section: FindingSection): Promise<SyncView[]> {
    const rows = await this.db.orgHealthFinding.findMany({ where: { connectionId, section }, select: { id: true, fingerprint: true, status: true, resolvedAt: true } });
    return rows.map((r) => ({ ...r, status: asStatus(r.status) }));
  }

  async insertMany(connectionId: string, findings: NewFinding[]): Promise<void> {
    for (const part of chunked(findings, 200)) {
      await this.db.orgHealthFinding.createMany({
        data: part.map(({ detectedAt, contributors, ...f }) => ({ ...f, connectionId, contributors: contributors as unknown as Prisma.InputJsonValue, firstDetectedAt: detectedAt, lastDetectedAt: detectedAt })),
      });
    }
  }

  async update(connectionId: string, id: string, update: FindingUpdate): Promise<StoredFinding | null> {
    // updateMany so a finding of another connection is simply not matched.
    const { count } = await this.db.orgHealthFinding.updateMany({ where: { id, connectionId }, data: data(update) });
    return count === 0 ? null : this.get(connectionId, id);
  }

  async resolveMany(connectionId: string, ids: string[], resolvedAt: Date, runId: string | null): Promise<void> {
    for (const part of chunked(ids, 500)) {
      await this.db.orgHealthFinding.updateMany({ where: { connectionId, id: { in: part } }, data: { status: "resolved", resolvedAt, lastRunId: runId } });
    }
  }

  async addEvents(events: NewFindingEvent[]): Promise<void> {
    for (const part of chunked(events, 500)) await this.db.orgHealthFindingEvent.createMany({ data: part });
  }

  async get(connectionId: string, id: string): Promise<StoredFinding | null> {
    const r = await this.db.orgHealthFinding.findFirst({ where: { id, connectionId } });
    return r ? toStored(r) : null;
  }

  async rows(connectionId: string, sections?: FindingSection[]): Promise<FindingRow[]> {
    const rows = await this.db.orgHealthFinding.findMany({ where: { connectionId, ...(sections ? { section: { in: sections } } : {}) }, select: ROW_SELECT });
    return rows.map(toRow);
  }

  async byComponent(connectionId: string, componentKey: string): Promise<FindingRow[]> {
    const rows = await this.db.orgHealthFinding.findMany({ where: { connectionId, componentKey }, select: ROW_SELECT });
    return rows.map(toRow);
  }

  async events(connectionId: string, findingId: string, limit: number): Promise<FindingEvent[]> {
    return this.db.orgHealthFindingEvent.findMany({ where: { findingId, finding: { connectionId } }, orderBy: { changedAt: "desc" }, take: limit });
  }
}
