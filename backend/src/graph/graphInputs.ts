import type { PrismaClient } from "@prisma/client";
import type {
  ApexClassInput,
  ApexMeta,
  ApexTriggerInput,
  DependencyInput,
  FlowInput,
  PermissionSetInput,
  SharingRuleDetails,
  SharingRuleInput,
  WorkflowRuleInput,
} from "./scanners/inputs";

// What the main scan already stored for one scan, read back for the graph stage. Behind an interface
// so the stage is tested without a database. Every method reads one table; no logic lives here.

export type StoredField = { apiName: string; type: string; referenceTo: string[] | null; sfId: string | null };
export type StoredObject = { apiName: string; label: string; sfId: string | null; fields: StoredField[] };

export interface ScanInputs {
  // Field labels from the scan's describe calls, keyed "Object.Field" (empty when unknown).
  fieldLabels(): Promise<Map<string, string>>;
  objects(): Promise<StoredObject[]>;
  apexClasses(): Promise<ApexClassInput[]>;
  triggers(): Promise<ApexTriggerInput[]>;
  flows(): Promise<FlowInput[]>;
  permissionSets(): Promise<PermissionSetInput[]>;
  workflowRules(): Promise<WorkflowRuleInput[]>;
  sharingRules(): Promise<SharingRuleInput[]>;
  dependencies(): Promise<DependencyInput[]>;
}

// What the scan sections saw but the tables have no column for (the schema is migration-controlled). It
// travels in memory from the sections to the graph stage of the same run, so a graph built from it is
// richer than one rebuilt from the tables alone. Every map is optional; absence just means fewer attributes.
export type WorkflowExtra = { description: string | null; formula: string | null; namespace: string | null };
export type ScanExtras = {
  // Keyed by Tooling Id.
  apexMeta: Map<string, ApexMeta>;
  triggerMeta: Map<string, ApexMeta>;
  // Classes and triggers whose source the API hides (managed packages). Kept out of the tables so the
  // analysis modules, which read bodies, never see them; the graph still gets the nodes.
  hiddenClasses: ApexClassInput[];
  hiddenTriggers: ApexTriggerInput[];
  // Keyed "Object.Name".
  workflow: Map<string, WorkflowExtra>;
  sharing: Map<string, SharingRuleDetails>;
  // Keyed "Object.Field", the describe label.
  fieldLabels: Map<string, string>;
};

export function emptyScanExtras(): ScanExtras {
  return { apexMeta: new Map(), triggerMeta: new Map(), hiddenClasses: [], hiddenTriggers: [], workflow: new Map(), sharing: new Map(), fieldLabels: new Map() };
}

// referenceTo is stored as Json; anything that is not an array of strings counts as "no targets".
function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const names = value.filter((v): v is string => typeof v === "string");
  return names.length > 0 ? names : null;
}

export class PrismaScanInputs implements ScanInputs {
  constructor(
    private readonly db: PrismaClient,
    private readonly scanId: string,
    private readonly extras: ScanExtras = emptyScanExtras()
  ) {}

  async fieldLabels(): Promise<Map<string, string>> {
    return this.extras.fieldLabels;
  }

  async objects(): Promise<StoredObject[]> {
    const rows = await this.db.sfObject.findMany({
      where: { scanId: this.scanId },
      select: { apiName: true, label: true, sfId: true, fields: { select: { apiName: true, type: true, referenceTo: true, sfId: true } } },
    });
    return rows.map((o) => ({
      apiName: o.apiName,
      label: o.label,
      sfId: o.sfId,
      fields: o.fields.map((f) => ({ apiName: f.apiName, type: f.type, referenceTo: asStringArray(f.referenceTo), sfId: f.sfId })),
    }));
  }

  async apexClasses(): Promise<ApexClassInput[]> {
    const rows = await this.db.apexClass.findMany({ where: { scanId: this.scanId }, select: { name: true, sfId: true, body: true, lineCount: true, apiVersion: true } });
    const stored: ApexClassInput[] = rows.map((r) => ({ ...r, meta: r.sfId ? this.extras.apexMeta.get(r.sfId) : undefined }));
    return [...stored, ...this.extras.hiddenClasses];
  }

  async triggers(): Promise<ApexTriggerInput[]> {
    const rows = await this.db.apexTrigger.findMany({ where: { scanId: this.scanId }, select: { name: true, sfId: true, objectName: true, body: true } });
    const stored: ApexTriggerInput[] = rows.map((r) => ({ ...r, meta: r.sfId ? this.extras.triggerMeta.get(r.sfId) : undefined }));
    return [...stored, ...this.extras.hiddenTriggers];
  }

  async flows(): Promise<FlowInput[]> {
    const rows = await this.db.flow.findMany({ where: { scanId: this.scanId }, select: { apiName: true, label: true, status: true, triggerType: true, objectName: true, sfId: true, definition: true } });
    return rows.map(({ definition, ...flow }) => {
      const def = definition && typeof definition === "object" && !Array.isArray(definition) ? (definition as Record<string, unknown>) : {};
      const text = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
      return { ...flow, processType: text(def.processType), description: text(def.description) };
    });
  }

  async permissionSets(): Promise<PermissionSetInput[]> {
    return this.db.permissionSet.findMany({ where: { scanId: this.scanId }, select: { name: true, sfId: true, permJson: true } });
  }

  async workflowRules(): Promise<WorkflowRuleInput[]> {
    const rows = await this.db.workflowRule.findMany({ where: { scanId: this.scanId }, select: { sfId: true, objectName: true, name: true, active: true, triggerType: true } });
    return rows.map((r) => ({ ...r, ...this.extras.workflow.get(`${r.objectName}.${r.name}`) }));
  }

  async sharingRules(): Promise<SharingRuleInput[]> {
    const rows = await this.db.sharingRule.findMany({ where: { scanId: this.scanId }, select: { objectName: true, name: true, ruleType: true, accessLevel: true } });
    return rows.map((r) => ({ ...r, details: this.extras.sharing.get(`${r.objectName}.${r.name}`) }));
  }

  async dependencies(): Promise<DependencyInput[]> {
    return this.db.componentDependency.findMany({
      where: { scanId: this.scanId },
      select: { componentId: true, componentName: true, componentType: true, refComponentId: true, refComponentName: true, refComponentType: true },
    });
  }
}

// Test double.
export class FakeScanInputs implements ScanInputs {
  stored: StoredObject[] = [];
  classes: ApexClassInput[] = [];
  apexTriggers: ApexTriggerInput[] = [];
  flowRows: FlowInput[] = [];
  permSets: PermissionSetInput[] = [];
  workflow: WorkflowRuleInput[] = [];
  sharing: SharingRuleInput[] = [];
  deps: DependencyInput[] = [];
  labels = new Map<string, string>();

  fieldLabels = async () => this.labels;
  objects = async () => this.stored;
  apexClasses = async () => this.classes;
  triggers = async () => this.apexTriggers;
  flows = async () => this.flowRows;
  permissionSets = async () => this.permSets;
  workflowRules = async () => this.workflow;
  sharingRules = async () => this.sharing;
  dependencies = async () => this.deps;
}
