import type { PrismaClient } from "@prisma/client";
import type {
  ApexClassInput,
  ApexTriggerInput,
  DependencyInput,
  FlowInput,
  PermissionSetInput,
  SharingRuleInput,
  WorkflowRuleInput,
} from "./scanners/inputs";

// What the main scan already stored for one scan, read back for the graph stage. Behind an interface
// so the stage is tested without a database. Every method reads one table; no logic lives here.

export type StoredField = { apiName: string; type: string; referenceTo: string[] | null; sfId: string | null };
export type StoredObject = { apiName: string; label: string; sfId: string | null; fields: StoredField[] };

export interface ScanInputs {
  objects(): Promise<StoredObject[]>;
  apexClasses(): Promise<ApexClassInput[]>;
  triggers(): Promise<ApexTriggerInput[]>;
  flows(): Promise<FlowInput[]>;
  permissionSets(): Promise<PermissionSetInput[]>;
  workflowRules(): Promise<WorkflowRuleInput[]>;
  sharingRules(): Promise<SharingRuleInput[]>;
  dependencies(): Promise<DependencyInput[]>;
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
    private readonly scanId: string
  ) {}

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
    return this.db.apexClass.findMany({ where: { scanId: this.scanId }, select: { name: true, sfId: true, body: true, lineCount: true, apiVersion: true } });
  }

  async triggers(): Promise<ApexTriggerInput[]> {
    return this.db.apexTrigger.findMany({ where: { scanId: this.scanId }, select: { name: true, sfId: true, objectName: true, body: true } });
  }

  async flows(): Promise<FlowInput[]> {
    return this.db.flow.findMany({ where: { scanId: this.scanId }, select: { apiName: true, label: true, status: true, triggerType: true, objectName: true, sfId: true } });
  }

  async permissionSets(): Promise<PermissionSetInput[]> {
    return this.db.permissionSet.findMany({ where: { scanId: this.scanId }, select: { name: true, sfId: true, permJson: true } });
  }

  async workflowRules(): Promise<WorkflowRuleInput[]> {
    return this.db.workflowRule.findMany({ where: { scanId: this.scanId }, select: { sfId: true, objectName: true, name: true, active: true, triggerType: true } });
  }

  async sharingRules(): Promise<SharingRuleInput[]> {
    return this.db.sharingRule.findMany({ where: { scanId: this.scanId }, select: { objectName: true, name: true, ruleType: true, accessLevel: true } });
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

  objects = async () => this.stored;
  apexClasses = async () => this.classes;
  triggers = async () => this.apexTriggers;
  flows = async () => this.flowRows;
  permissionSets = async () => this.permSets;
  workflowRules = async () => this.workflow;
  sharingRules = async () => this.sharing;
  dependencies = async () => this.deps;
}
