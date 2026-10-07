import { dedupeEdges, edgeDraft, nodeDraft } from "../draft";
import type { ObjectIndex } from "../objectIndex";
import { isNamespaceInScope, type ScopeOptions } from "../scope";
import { emptyOutput, type ScannerOutput } from "../types";
import type { ApprovalProcessInput, EmailAlertInput, SharingRuleInput, ValidationRuleInput, WorkflowRuleInput } from "./inputs";

// Components that hang off one object. Names are only unique within their object, so the fqn is
// `Object.Name`. The object is resolved through the index: a rule on an out-of-scope object is
// skipped whole, because without its object it is an orphan node with nothing to explain it.

type ObjectBound = { objectName: string; name: string; sfId?: string | null; namespace?: string | null };

function scanBound<T extends ObjectBound>(
  items: T[],
  index: ObjectIndex,
  kind: "ValidationRule" | "WorkflowRule" | "EmailAlert" | "ApprovalProcess" | "SharingRule",
  edge: "VALIDATES" | "APPLIES_TO",
  describe: (item: T) => { label: string; attributes: Record<string, unknown> },
  options?: ScopeOptions
): ScannerOutput {
  const out = emptyOutput();
  for (const item of items) {
    if (options && !isNamespaceInScope(item.namespace ?? null, options)) continue;
    const owner = index.resolve(item.objectName);
    if (!owner) continue;
    const { label, attributes } = describe(item);
    const { key, draft } = nodeDraft(kind, { fqn: `${owner.name}.${item.name}`, label, parentKey: owner.nodeKey, namespace: item.namespace ?? null, attributes: { ...attributes, objectApiName: owner.name } });
    out.nodes.push(draft);
    if (item.sfId) out.ids.push([item.sfId, key]);
    out.edges.push(edgeDraft(edge, key, owner.nodeKey));
  }
  out.edges = dedupeEdges(out.edges);
  return out;
}

export const scanValidationRules = (rules: ValidationRuleInput[], index: ObjectIndex, options: ScopeOptions) =>
  scanBound(rules, index, "ValidationRule", "VALIDATES", (r) => ({ label: r.name, attributes: { active: r.active, description: r.description, errorMessage: r.errorMessage } }), options);

export const scanWorkflowRules = (rules: WorkflowRuleInput[], index: ObjectIndex) =>
  scanBound(rules, index, "WorkflowRule", "APPLIES_TO", (r) => ({ label: r.name, attributes: { active: r.active, triggerType: r.triggerType } }));

export const scanEmailAlerts = (alerts: EmailAlertInput[], index: ObjectIndex, options: ScopeOptions) =>
  scanBound(alerts, index, "EmailAlert", "APPLIES_TO", (a) => ({ label: a.name, attributes: { description: a.description } }), options);

export const scanApprovalProcesses = (processes: ApprovalProcessInput[], index: ObjectIndex, options: ScopeOptions) =>
  scanBound(processes, index, "ApprovalProcess", "APPLIES_TO", (p) => ({ label: p.label || p.name, attributes: { state: p.state, description: p.description } }), options);

export const scanSharingRules = (rules: SharingRuleInput[], index: ObjectIndex) =>
  scanBound(rules, index, "SharingRule", "APPLIES_TO", (r) => ({ label: r.name, attributes: { ruleType: r.ruleType, accessLevel: r.accessLevel } }));
