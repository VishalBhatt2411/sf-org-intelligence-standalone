import type { StoredNode } from "../graph/graphReadRepository";
import { DEFAULT_HEALTH_CONFIG, SECTIONS, sectionInfo, type HealthConfig } from "./config";
import { HealthInputError, HealthNotFoundError } from "./errors";
import { applyTriage } from "./findings/findingTriage";
import { syncFindings, type SyncOutcome } from "./findings/findingSync";
import { SYSTEM_ACTOR, isOverdue, isRiskAcceptanceExpired, type FindingEvent, type FindingRepository, type FindingRow, type StoredFinding } from "./findings/findingTypes";
import { exportCsv, filterRows, parseRemediationQuery, remediationPage, summarize, type RemediationPage, type RemediationRow, type RemediationSummary } from "./findings/remediation";
import type { HealthGraphRepository } from "./healthGraphRepository";
import type { HealthSource } from "./healthSource";
import type { HealthRun, RunRepository, SnapshotRepository, TrendPoint } from "./healthStore";
import { severityRegistry } from "./registry";
import { computeAutomation, automationDrilldown } from "./sections/automation";
import { codeDrilldown, computeCode } from "./sections/code";
import { computeData } from "./sections/data";
import { metadataDrilldown, computeMetadata } from "./sections/metadata";
import { buildSummary, computeOverview, type SummaryCard } from "./sections/overview";
import { computeSecurity } from "./sections/security";
import { computeStorage } from "./sections/storage";
import { errorText, type DrilldownResult, type LiveSectionContext, type SectionContext } from "./sections/shared";
import { emptySection, isFindingSection, isSectionKey, type FindingSection, type SectionComputation, type SectionKey, type SectionResult } from "./types";

// Org Health orchestration: which section is served from where, what a sync does, and the finding
// workflow around them. Business rules live in the section computations and the findings modules;
// this class only wires them to storage. Everything is scoped to one connection.

export type HealthDeps = {
  graph: HealthGraphRepository;
  findings: FindingRepository;
  snapshots: SnapshotRepository;
  runs: RunRepository;
  // Opens the Salesforce reads for a connection (live sections only).
  sourceFor: (connectionId: string) => Promise<HealthSource>;
  config?: HealthConfig;
  now?: () => Date;
  // How a background job is started; the default lets it run on its own (a test passes one it can await).
  spawn?: (job: Promise<void>) => void;
};

// Sections computed from the graph tables, and the ones read from Salesforce.
const SCAN_SECTIONS = ["overview", "metadata", "automation", "code"] as const;

const DRILLDOWNS: Partial<Record<SectionKey, readonly string[]>> = {
  metadata: ["HighFieldCount", "HighDegree", "OrphanRate", "DependencyDensity"],
  automation: ["HighDependency", "Cycles"],
  code: ["HighDependency", "OldApiVersion", "Cycles"],
};

const STALE_RUN_MS = 15 * 60_000;
const TREND_POINTS = 60;
const HISTORY_LIMIT = 100;
const MESSAGE_LIMIT = 500;
const INTERRUPTED = "The run was interrupted before it finished.";

export type FindingDetail = StoredFinding & { overdue: boolean; riskExpired: boolean };
export type SyncReport = { section: SectionKey; result: SectionResult; findings: SyncOutcome | null };

export class HealthService {
  private readonly config: HealthConfig;
  private readonly clock: () => Date;
  private readonly spawn: (job: Promise<void>) => void;
  // Connections with a Data run executing in this process.
  private readonly running = new Set<string>();
  // The run row of a start still in progress, so a request arriving mid-start can answer with it.
  private readonly starting = new Map<string, Promise<HealthRun>>();

  constructor(private readonly deps: HealthDeps) {
    this.config = deps.config ?? DEFAULT_HEALTH_CONFIG;
    this.clock = deps.now ?? (() => new Date());
    this.spawn = deps.spawn ?? ((job) => void job);
  }

  // ---- sections ----

  assertSection(value: unknown): SectionKey {
    if (!isSectionKey(value)) throw new HealthInputError("Unknown section");
    return value;
  }

  private graphContext(connectionId: string): SectionContext {
    return { graph: this.deps.graph, connectionId, config: this.config, now: this.clock() };
  }

  private async liveContext(connectionId: string): Promise<LiveSectionContext> {
    return { source: await this.deps.sourceFor(connectionId), connectionId, config: this.config, now: this.clock() };
  }

  private async computeScanSection(connectionId: string, section: (typeof SCAN_SECTIONS)[number]): Promise<SectionComputation> {
    const ctx = this.graphContext(connectionId);
    switch (section) {
      case "overview":
        return { result: await computeOverview(ctx), candidates: [] };
      case "metadata":
        return computeMetadata(ctx);
      case "automation":
        return computeAutomation(ctx);
      case "code":
        return computeCode(ctx);
    }
  }

  private notRun(section: SectionKey): SectionResult {
    const info = sectionInfo(section);
    return emptySection(section, info.label, { scored: info.scored, basis: "live", coverage: { complete: false, note: "Not run yet — run the check to read it from Salesforce." } });
  }

  // The section as the page shows it. Scan sections: the latest stored result, or computed now if none was
  // stored yet (a GET never writes). Security and Data: the latest stored result, or a "not run yet" shell.
  // Storage: read live every time.
  async section(connectionId: string, section: SectionKey): Promise<SectionResult> {
    if (section === "storage") return computeStorage(await this.liveContext(connectionId));
    const stored = await this.deps.snapshots.latest(connectionId, section);
    if (stored) return stored.result;
    if (section === "security" || section === "data") return this.notRun(section);
    return (await this.computeScanSection(connectionId, section)).result;
  }

  async drilldown(connectionId: string, section: SectionKey, metricKey: unknown): Promise<DrilldownResult> {
    const allowed = DRILLDOWNS[section];
    if (!allowed) throw new HealthInputError("This section has no drill-down");
    if (typeof metricKey !== "string" || !allowed.includes(metricKey)) throw new HealthInputError(`metricKey must be one of: ${allowed.join(", ")}`);
    const ctx = this.graphContext(connectionId);
    if (section === "metadata") return metadataDrilldown(ctx, metricKey);
    if (section === "automation") return automationDrilldown(ctx, metricKey);
    return codeDrilldown(ctx, metricKey);
  }

  async summary(connectionId: string): Promise<{ cards: SummaryCard[]; findings: RemediationSummary }> {
    const results: Partial<Record<SectionKey, SectionResult>> = {};
    for (const s of SECTIONS) {
      if (s.key === "storage") continue;
      results[s.key] = await this.section(connectionId, s.key);
    }
    return { cards: buildSummary(results), findings: summarize(await this.deps.findings.rows(connectionId), this.clock()) };
  }

  async trend(connectionId: string, section: unknown): Promise<TrendPoint[]> {
    const key = this.assertSection(section);
    return this.deps.snapshots.trend(connectionId, key, TREND_POINTS);
  }

  severityRegistry() {
    return severityRegistry(this.config);
  }

  // ---- sync ----

  private async store(connectionId: string, computation: SectionComputation, runId: string | null): Promise<SyncReport> {
    const { result, candidates } = computation;
    const now = this.clock();
    await this.deps.snapshots.save(connectionId, result, now);
    if (!isFindingSection(result.section)) return { section: result.section, result, findings: null };
    // A run that could not see everything must not be taken as proof that a problem went away.
    const autoResolve = result.coverage.complete && result.unavailable.length === 0;
    const findings = await syncFindings(this.deps.findings, connectionId, result.section as FindingSection, candidates, { runId, now, autoResolve });
    return { section: result.section, result, findings };
  }

  // Recompute one section now, store it and bring its findings up to date. Data has its own async run.
  async sync(connectionId: string, section: SectionKey): Promise<SyncReport> {
    if (section === "data") throw new HealthInputError("Data health runs in the background; start it with a data run");
    if (section === "storage") throw new HealthInputError("Storage is read live; there is nothing to sync");
    if (section === "security") return this.store(connectionId, await computeSecurity(await this.liveContext(connectionId)), null);
    return this.store(connectionId, await this.computeScanSection(connectionId, section), null);
  }

  // After a successful scan: refresh every scan-derived section. One section failing never stops the
  // others, and nothing here may fail the scan, so errors are logged and returned, not thrown.
  async syncAfterScan(connectionId: string): Promise<{ failed: SectionKey[] }> {
    const failed: SectionKey[] = [];
    for (const section of SCAN_SECTIONS) {
      try {
        await this.store(connectionId, await this.computeScanSection(connectionId, section), null);
      } catch (err) {
        failed.push(section);
        console.warn(`org health: sync of "${section}" after scan failed:`, errorText(err));
      }
    }
    return { failed };
  }

  // ---- Data run (background) ----

  // The latest Data run. A run still marked running that this process is not executing, and that started
  // long ago, was lost (restart, crash); it is closed as failed so the UI does not wait for it forever.
  async dataRun(connectionId: string): Promise<HealthRun | null> {
    const run = await this.deps.runs.latest(connectionId, "data");
    if (!run || run.status !== "running" || this.running.has(connectionId)) return run;
    if (this.clock().getTime() - run.startedAt.getTime() <= STALE_RUN_MS) return run;
    const now = this.clock();
    await this.deps.runs.finish(connectionId, run.id, "failed", INTERRUPTED, now);
    return { ...run, status: "failed", message: INTERRUPTED, finishedAt: now };
  }

  // Starts a Data run and returns at once; the page polls dataRun(). One run per connection at a time.
  // The run executes in this process, so a "running" row this process is not executing is an orphan
  // (a restart or crash) and is closed before the new run starts.
  async startDataRun(connectionId: string): Promise<{ run: HealthRun; started: boolean }> {
    if (this.running.has(connectionId)) {
      const pending = this.starting.get(connectionId);
      const current = pending ? await pending : await this.deps.runs.latest(connectionId, "data");
      if (current) return { run: current, started: false };
    }
    // Claimed before any await, so two requests arriving together cannot both start a run.
    this.running.add(connectionId);
    const begin = this.beginDataRun(connectionId);
    this.starting.set(connectionId, begin);
    try {
      const run = await begin;
      this.spawn(this.executeDataRun(connectionId, run.id));
      return { run, started: true };
    } catch (err) {
      this.running.delete(connectionId);
      throw err;
    } finally {
      this.starting.delete(connectionId);
    }
  }

  private async beginDataRun(connectionId: string): Promise<HealthRun> {
    const previous = await this.deps.runs.latest(connectionId, "data");
    if (previous?.status === "running") await this.deps.runs.finish(connectionId, previous.id, "failed", INTERRUPTED, this.clock());
    return this.deps.runs.start(connectionId, "data", this.clock());
  }

  private async executeDataRun(connectionId: string, runId: string): Promise<void> {
    try {
      const computation = await computeData(await this.liveContext(connectionId));
      await this.store(connectionId, computation, runId);
      const note = computation.result.unavailable.length > 0 ? `Finished, but ${computation.result.unavailable.length} read(s) were unavailable.` : null;
      await this.deps.runs.finish(connectionId, runId, "succeeded", note, this.clock());
    } catch (err) {
      console.warn("org health: data run failed:", errorText(err));
      await this.deps.runs.finish(connectionId, runId, "failed", `The run failed: ${errorText(err)}`.slice(0, MESSAGE_LIMIT), this.clock()).catch(() => undefined);
    } finally {
      this.running.delete(connectionId);
    }
  }

  // ---- findings ----

  private async rowsFor(connectionId: string, sections?: FindingSection[]): Promise<FindingRow[]> {
    return this.deps.findings.rows(connectionId, sections);
  }

  // The findings table and the remediation queue are the same query; `section` is the single-section shorthand.
  async listFindings(connectionId: string, raw: Record<string, unknown>): Promise<RemediationPage> {
    const query = parseRemediationQuery("section" in raw && !("sections" in raw) ? { ...raw, sections: raw.section } : raw);
    return remediationPage(await this.rowsFor(connectionId, query.sections), query, this.clock());
  }

  async remediationSummary(connectionId: string): Promise<RemediationSummary> {
    return summarize(await this.rowsFor(connectionId), this.clock());
  }

  async remediationCsv(connectionId: string, raw: Record<string, unknown>): Promise<{ csv: string; total: number; truncated: boolean }> {
    const query = parseRemediationQuery(raw);
    return exportCsv(await this.rowsFor(connectionId, query.sections), query, this.clock());
  }

  private async mustGet(connectionId: string, id: string): Promise<StoredFinding> {
    const found = await this.deps.findings.get(connectionId, id);
    if (!found) throw new HealthNotFoundError("Finding not found");
    return found;
  }

  async finding(connectionId: string, id: string): Promise<FindingDetail> {
    const f = await this.mustGet(connectionId, id);
    const now = this.clock();
    return { ...f, overdue: isOverdue(f, now), riskExpired: isRiskAcceptanceExpired(f, now) };
  }

  // Other findings on the same component.
  async related(connectionId: string, id: string): Promise<RemediationRow[]> {
    const f = await this.mustGet(connectionId, id);
    const now = this.clock();
    const others = (await this.deps.findings.byComponent(connectionId, f.componentKey)).filter((r) => r.id !== id);
    return filterRows(others, { sort: "severity", direction: "desc", limit: others.length, offset: 0 }, now);
  }

  async history(connectionId: string, id: string): Promise<FindingEvent[]> {
    await this.mustGet(connectionId, id);
    return this.deps.findings.events(connectionId, id, HISTORY_LIMIT);
  }

  // The graph node a finding is about, so the UI can open it in the Explorer.
  async navigate(connectionId: string, id: string): Promise<Pick<StoredNode, "nodeKey" | "typeKey" | "label" | "fqn">> {
    const f = await this.mustGet(connectionId, id);
    const [node] = await this.deps.graph.getNodes(connectionId, [f.componentKey]);
    if (!node) throw new HealthNotFoundError("This component is not in the graph (it may have been removed since the finding was raised)");
    return { nodeKey: node.nodeKey, typeKey: node.typeKey, label: node.label, fqn: node.fqn };
  }

  async triage(connectionId: string, id: string, body: unknown, actor: string): Promise<FindingDetail> {
    await applyTriage(this.deps.findings, connectionId, id, body, actor || SYSTEM_ACTOR, this.clock());
    return this.finding(connectionId, id);
  }
}
