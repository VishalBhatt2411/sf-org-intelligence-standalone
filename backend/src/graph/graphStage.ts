import { GraphBuildSession } from "./graphBuilder";
import type { ScanInputs, StoredObject } from "./graphInputs";
import type { GraphRepository, RetireResult } from "./graphRepository";
import type { GraphSource } from "./graphSource";
import { edgeTypeKey, nodeTypeKey, type EdgeKind, type NodeKind } from "./nodeTypes";
import { ObjectIndex, normaliseSfId } from "./objectIndex";
import { isObjectInScope, isRelationshipFieldCandidate, type ScopeOptions } from "./scope";
import { classKeyIndex, scanApexClasses, scanApexTriggers } from "./scanners/apex";
import { scanDependencies } from "./scanners/dependencies";
import { scanFlows } from "./scanners/flows";
import type { PermissionSetMeta, StoredFieldInfo } from "./scanners/inputs";
import { scanApprovalProcesses, scanEmailAlerts, scanSharingRules, scanValidationRules, scanWorkflowRules } from "./scanners/objectRules";
import { scanPermissionSets } from "./scanners/permissionSets";
import { scanObjects, scanRelationshipFields } from "./scanners/structure";
import type { GraphSettings } from "./settings";
import type { Coverage, EdgeScope, ScannerOutput } from "./types";

// The "graph" part of a scan: runs the pure scanners over what the main scan stored (plus a few live
// reads), writes each result through the builder as its own stage, and retires what disappeared only
// when every stage that owns it produced a complete snapshot. A failing stage never aborts the others.

export type SectionCoverage = { coverage: Coverage; detail?: string | null };
export type StageRecord = { category: string; itemCount: number; coverage: Coverage; coverageDetail: string | null };
export type GraphStageResult = {
  records: StageRecord[];
  // True when any stage failed outright (coverage "degraded"); the scan is then completed_with_errors.
  degraded: boolean;
  retired: RetireResult;
};

export type GraphStageDeps = {
  source: GraphSource;
  inputs: ScanInputs;
  repository: GraphRepository;
  connectionId: string;
  scanId: string;
  settings: GraphSettings;
  // Coverage of the main scan's sections, keyed by section category. A stage that reads a section that
  // was not complete cannot be a full snapshot.
  sections: ReadonlyMap<string, SectionCoverage>;
};

type StageRun = { output: ScannerOutput; coverage?: Coverage; detail?: string | null };
type StageDef = { category: string; needs: string[]; run: () => Promise<StageRun> };

// Which stages must all be complete before a set of node types / edge scopes may be retired. Shared
// rows (a field can be built by the field stage or, on demand, by the dependency stage) list every
// stage that can produce them.
type Retirement = { requires: string[]; nodes: NodeKind[]; edges: Array<[EdgeKind, NodeKind | null]> };
const RETIREMENTS: Retirement[] = [
  { requires: ["objects"], nodes: ["CustomObject"], edges: [] },
  { requires: ["relationship_fields", "dependencies"], nodes: ["CustomField"], edges: [["HAS_FIELD", "CustomObject"]] },
  { requires: ["relationship_fields"], nodes: [], edges: [["LOOKUP_TO", "CustomField"], ["MASTER_DETAIL_TO", "CustomField"]] },
  { requires: ["apex_classes"], nodes: ["ApexClass"], edges: [["REFERENCES", "ApexClass"]] },
  { requires: ["triggers"], nodes: ["ApexTrigger"], edges: [["REFERENCES", "ApexTrigger"], ["EXECUTES_ON", "ApexTrigger"]] },
  { requires: ["flows"], nodes: ["Flow"], edges: [["EXECUTES_ON", "Flow"]] },
  { requires: ["permission_sets"], nodes: ["PermissionSet"], edges: [["GRANTS_ACCESS_TO", "PermissionSet"]] },
  { requires: ["validation_rules"], nodes: ["ValidationRule"], edges: [["VALIDATES", "ValidationRule"]] },
  { requires: ["workflow_rules"], nodes: ["WorkflowRule"], edges: [["APPLIES_TO", "WorkflowRule"]] },
  { requires: ["email_alerts"], nodes: ["EmailAlert"], edges: [["APPLIES_TO", "EmailAlert"]] },
  { requires: ["approval_processes"], nodes: ["ApprovalProcess"], edges: [["APPLIES_TO", "ApprovalProcess"]] },
  { requires: ["sharing_rules"], nodes: ["SharingRule"], edges: [["APPLIES_TO", "SharingRule"]] },
  { requires: ["dependencies"], nodes: [], edges: [["DEPENDS_ON", null]] },
];

const GRAPH_PREFIX = "graph_";
const MAX_DETAIL = 300;

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text;
}

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => (cached ??= load());
}

export async function runGraphStage(deps: GraphStageDeps): Promise<GraphStageResult> {
  const { source, inputs, settings } = deps;
  const records: StageRecord[] = [];
  const noRetire: RetireResult = { nodes: 0, edges: 0 };

  // Scope decides what is in the graph and therefore what may be retired, so without it nothing is safe.
  let orgNamespace: string | null;
  let global: Awaited<ReturnType<GraphSource["listObjects"]>>;
  let stored: StoredObject[];
  try {
    [orgNamespace, global, stored] = await Promise.all([source.orgNamespace(), source.listObjects(), inputs.objects()]);
  } catch (error) {
    console.warn("graph scope could not be determined:", (error as Error).message);
    return { records: [{ category: `${GRAPH_PREFIX}scope`, itemCount: 0, coverage: "degraded", coverageDetail: message(error) }], degraded: true, retired: noRetire };
  }

  const scope: ScopeOptions = { settings, orgNamespace };
  const globalByName = new Map(global.map((o) => [o.name, o]));
  const inScope = stored.filter((o) => {
    const live = globalByName.get(o.apiName);
    if (!live) return false;
    const customFieldCount = o.fields.filter((f) => f.apiName.endsWith("__c")).length;
    return isObjectInScope({ name: o.apiName, custom: live.custom, queryable: live.queryable, customFieldCount }, scope);
  });
  const index = new ObjectIndex(inScope.map((o) => ({ name: o.apiName, sfId: o.sfId })));

  const session = new GraphBuildSession(deps.repository, deps.connectionId, deps.scanId);
  const idToKey = new Map<string, string>();
  const classes = once(() => inputs.apexClasses());
  const permissionOptions = { settings, orgNamespace };

  const stages: StageDef[] = [
    { category: "objects", needs: ["objects"], run: async () => ({ output: scanObjects(inScope.map((o) => ({ apiName: o.apiName, label: o.label, sfId: o.sfId }))) }) },
    {
      category: "relationship_fields",
      needs: ["objects"],
      run: async () => {
        const wanted = inScope.filter((o) => o.fields.some((f) => isRelationshipFieldCandidate({ name: f.apiName, type: f.type, referenceTo: f.referenceTo }))).map((o) => o.apiName);
        if (wanted.length === 0) return { output: scanRelationshipFields([], index) };
        const { described, failed } = await source.describe(wanted);
        const idByField = new Map<string, string>();
        for (const o of inScope) for (const f of o.fields) if (f.sfId) idByField.set(`${o.apiName}.${f.apiName}`, f.sfId);
        const withIds = described.map((d) => ({ ...d, fields: d.fields.map((f) => ({ ...f, sfId: idByField.get(`${d.name}.${f.name}`) ?? null })) }));
        const output = scanRelationshipFields(withIds, index);
        if (failed.length > 0) return { output, coverage: "partial", detail: `describe failed for ${failed.length} object(s)` };
        return { output };
      },
    },
    { category: "apex_classes", needs: ["apex_classes"], run: async () => ({ output: scanApexClasses(await classes()) }) },
    { category: "triggers", needs: ["triggers", "apex_classes"], run: async () => ({ output: scanApexTriggers(await inputs.triggers(), await classes(), index) }) },
    { category: "flows", needs: ["flows"], run: async () => ({ output: scanFlows(await inputs.flows(), index) }) },
    {
      category: "permission_sets",
      needs: ["permissions", "apex_classes"],
      run: async () => {
        const [sets, meta, list] = await Promise.all([inputs.permissionSets(), source.permissionSetMeta(), classes()]);
        const metaByName = new Map<string, PermissionSetMeta>(meta.map((m) => [m.name, m]));
        return { output: scanPermissionSets(sets, metaByName, index, classKeyIndex(list), permissionOptions) };
      },
    },
    { category: "validation_rules", needs: [], run: async () => ({ output: scanValidationRules(await source.validationRules(), index, scope) }) },
    { category: "workflow_rules", needs: ["workflow_rules"], run: async () => ({ output: scanWorkflowRules(await inputs.workflowRules(), index) }) },
    { category: "email_alerts", needs: [], run: async () => ({ output: scanEmailAlerts(await source.emailAlerts(), index, scope) }) },
    { category: "approval_processes", needs: [], run: async () => ({ output: scanApprovalProcesses(await source.approvalProcesses(), index, scope) }) },
    { category: "sharing_rules", needs: ["sharing_rules", "sharing_model"], run: async () => ({ output: scanSharingRules(await inputs.sharingRules(), index) }) },
  ];

  stages.push({
    category: "dependencies",
    needs: ["dependencies"],
    run: async () => {
      const fieldBySfId = new Map<string, StoredFieldInfo>();
      for (const o of inScope) {
        for (const f of o.fields) {
          if (f.sfId) fieldBySfId.set(normaliseSfId(f.sfId), { objectName: o.apiName, fieldName: f.apiName, label: f.apiName, type: f.type });
        }
      }
      const output = scanDependencies(await inputs.dependencies(), { idToKey, knownKeys: session.emittedKeys, fieldBySfId, index });
      // Endpoints with no node (layouts, reports, out-of-scope objects) are expected; they are noted, not a gap.
      const detail = output.unresolved > 0 ? `${output.unresolved} dependency endpoint(s) have no node in the graph` : null;
      const earlier = records.filter((r) => r.coverage !== "complete");
      if (earlier.length > 0) return { output, coverage: "partial", detail: `some dependencies may be missing: ${earlier.map((r) => r.category.slice(GRAPH_PREFIX.length)).join(", ")} incomplete` };
      return { output, detail };
    },
  });

  for (const stage of stages) records.push(await runStage(stage));

  async function runStage(stage: StageDef): Promise<StageRecord> {
    const category = `${GRAPH_PREFIX}${stage.category}`;
    try {
      const run = await stage.run();
      const stats = await session.applyStage(run.output);
      for (const [sfId, key] of run.output.ids) idToKey.set(normaliseSfId(sfId), key);

      let coverage: Coverage = run.coverage ?? "complete";
      let detail = run.detail ?? null;
      const incomplete = stage.needs.filter((n) => deps.sections.get(n)?.coverage !== "complete");
      if (incomplete.length > 0 && coverage === "complete") {
        coverage = "partial";
        detail = `scan section(s) not complete: ${incomplete.join(", ")}`;
      }
      if (stats.droppedEdges > 0 && coverage === "complete") {
        coverage = "partial";
        detail = `${stats.droppedEdges} edge(s) dropped: endpoint not in the graph`;
      }
      const itemCount = stats.nodes.created + stats.nodes.updated + stats.nodes.unchanged;
      return { category, itemCount, coverage, coverageDetail: detail };
    } catch (error) {
      console.warn(`graph stage "${stage.category}" failed:`, (error as Error).message);
      return { category, itemCount: 0, coverage: "degraded", coverageDetail: message(error) };
    }
  }

  const complete = new Set(records.filter((r) => r.coverage === "complete").map((r) => r.category.slice(GRAPH_PREFIX.length)));
  const nodeTypes: string[] = [];
  const edgeScopes: EdgeScope[] = [];
  for (const group of RETIREMENTS) {
    if (!group.requires.every((stage) => complete.has(stage))) continue;
    nodeTypes.push(...group.nodes.map(nodeTypeKey));
    edgeScopes.push(...group.edges.map(([edge, source]) => ({ typeKey: edgeTypeKey(edge), sourceTypeKey: source ? nodeTypeKey(source) : null })));
  }

  let retired = noRetire;
  try {
    retired = await session.retire(nodeTypes, edgeScopes);
  } catch (error) {
    console.warn("graph retire failed:", (error as Error).message);
    records.push({ category: `${GRAPH_PREFIX}retire`, itemCount: 0, coverage: "degraded", coverageDetail: message(error) });
  }

  return { records, degraded: records.some((r) => r.coverage === "degraded"), retired };
}
