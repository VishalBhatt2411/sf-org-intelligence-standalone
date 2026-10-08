import type { Prisma, PrismaClient } from "@prisma/client";
import type { SectionKey, SectionResult, Severity } from "./types";

// Stored section results (snapshots) and Data Health runs. Everything is scoped to one connection.

export const SNAPSHOTS_KEPT = 100;

export type Snapshot = { id: string; section: SectionKey; score: number | null; severity: Severity | null; result: SectionResult; createdAt: Date };
export type TrendPoint = { at: string; score: number | null; severity: Severity | null };

export interface SnapshotRepository {
  // Stores a result and drops all but the newest SNAPSHOTS_KEPT of that section.
  save(connectionId: string, result: SectionResult, now: Date): Promise<Snapshot>;
  latest(connectionId: string, section: SectionKey): Promise<Snapshot | null>;
  // Oldest first, ready to plot.
  trend(connectionId: string, section: SectionKey, limit: number): Promise<TrendPoint[]>;
}

export type RunStatus = "running" | "succeeded" | "failed";
export type HealthRun = { id: string; section: SectionKey; status: RunStatus; message: string | null; startedAt: Date; finishedAt: Date | null };

export interface RunRepository {
  start(connectionId: string, section: SectionKey, now: Date): Promise<HealthRun>;
  finish(connectionId: string, id: string, status: Exclude<RunStatus, "running">, message: string | null, now: Date): Promise<void>;
  latest(connectionId: string, section: SectionKey): Promise<HealthRun | null>;
}

const asSeverity = (v: string | null): Severity | null => (v === "good" || v === "warning" || v === "critical" ? v : null);
const asStatus = (v: string): RunStatus => (v === "succeeded" || v === "failed" ? v : "running");

export class PrismaSnapshotRepository implements SnapshotRepository {
  constructor(private readonly db: PrismaClient) {}

  async save(connectionId: string, result: SectionResult, now: Date): Promise<Snapshot> {
    const row = await this.db.orgHealthSnapshot.create({
      data: { connectionId, section: result.section, score: result.score, severity: result.severity, result: result as unknown as Prisma.InputJsonValue, createdAt: now },
    });
    const old = await this.db.orgHealthSnapshot.findMany({ where: { connectionId, section: result.section }, orderBy: { createdAt: "desc" }, skip: SNAPSHOTS_KEPT, select: { id: true } });
    if (old.length > 0) await this.db.orgHealthSnapshot.deleteMany({ where: { connectionId, id: { in: old.map((o) => o.id) } } });
    return { id: row.id, section: result.section, score: row.score, severity: asSeverity(row.severity), result, createdAt: row.createdAt };
  }

  async latest(connectionId: string, section: SectionKey): Promise<Snapshot | null> {
    const row = await this.db.orgHealthSnapshot.findFirst({ where: { connectionId, section }, orderBy: { createdAt: "desc" } });
    return row ? { id: row.id, section, score: row.score, severity: asSeverity(row.severity), result: row.result as unknown as SectionResult, createdAt: row.createdAt } : null;
  }

  async trend(connectionId: string, section: SectionKey, limit: number): Promise<TrendPoint[]> {
    const rows = await this.db.orgHealthSnapshot.findMany({ where: { connectionId, section }, orderBy: { createdAt: "desc" }, take: limit, select: { score: true, severity: true, createdAt: true } });
    return rows.reverse().map((r) => ({ at: r.createdAt.toISOString(), score: r.score, severity: asSeverity(r.severity) }));
  }
}

export class PrismaRunRepository implements RunRepository {
  constructor(private readonly db: PrismaClient) {}

  async start(connectionId: string, section: SectionKey, now: Date): Promise<HealthRun> {
    const r = await this.db.orgHealthRun.create({ data: { connectionId, section, startedAt: now } });
    return { id: r.id, section, status: "running", message: null, startedAt: r.startedAt, finishedAt: null };
  }

  async finish(connectionId: string, id: string, status: Exclude<RunStatus, "running">, message: string | null, now: Date): Promise<void> {
    await this.db.orgHealthRun.updateMany({ where: { id, connectionId }, data: { status, message, finishedAt: now } });
  }

  async latest(connectionId: string, section: SectionKey): Promise<HealthRun | null> {
    const r = await this.db.orgHealthRun.findFirst({ where: { connectionId, section }, orderBy: { startedAt: "desc" } });
    return r ? { id: r.id, section, status: asStatus(r.status), message: r.message, startedAt: r.startedAt, finishedAt: r.finishedAt } : null;
  }
}

// Test doubles.
export class InMemorySnapshotRepository implements SnapshotRepository {
  readonly rows: Array<Snapshot & { connectionId: string }> = [];
  private seq = 0;

  async save(connectionId: string, result: SectionResult, now: Date): Promise<Snapshot> {
    const snap = { id: `snap-${++this.seq}`, connectionId, section: result.section, score: result.score, severity: result.severity, result, createdAt: now };
    this.rows.push(snap);
    const mine = this.rows.filter((r) => r.connectionId === connectionId && r.section === result.section).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || Number(b.id.slice(5)) - Number(a.id.slice(5)));
    for (const old of mine.slice(SNAPSHOTS_KEPT)) this.rows.splice(this.rows.indexOf(old), 1);
    return snap;
  }

  private mine(connectionId: string, section: SectionKey) {
    return this.rows.filter((r) => r.connectionId === connectionId && r.section === section).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || Number(a.id.slice(5)) - Number(b.id.slice(5)));
  }

  async latest(connectionId: string, section: SectionKey): Promise<Snapshot | null> {
    return this.mine(connectionId, section).at(-1) ?? null;
  }

  async trend(connectionId: string, section: SectionKey, limit: number): Promise<TrendPoint[]> {
    return this.mine(connectionId, section).slice(-limit).map((r) => ({ at: r.createdAt.toISOString(), score: r.score, severity: r.severity }));
  }
}

export class InMemoryRunRepository implements RunRepository {
  readonly runs: Array<HealthRun & { connectionId: string }> = [];
  private seq = 0;

  async start(connectionId: string, section: SectionKey, now: Date): Promise<HealthRun> {
    const run = { id: `run-${++this.seq}`, connectionId, section, status: "running" as RunStatus, message: null, startedAt: now, finishedAt: null };
    this.runs.push(run);
    return run;
  }

  async finish(connectionId: string, id: string, status: Exclude<RunStatus, "running">, message: string | null, now: Date): Promise<void> {
    const run = this.runs.find((r) => r.id === id && r.connectionId === connectionId);
    if (run) Object.assign(run, { status, message, finishedAt: now });
  }

  async latest(connectionId: string, section: SectionKey): Promise<HealthRun | null> {
    const mine = this.runs.filter((r) => r.connectionId === connectionId && r.section === section);
    return mine.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || Number(a.id.slice(4)) - Number(b.id.slice(4))).at(-1) ?? null;
  }
}
