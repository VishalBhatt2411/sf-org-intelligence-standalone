import { dedupeEdges, edgeDraft, nodeDraft } from "../draft";
import type { ObjectIndex } from "../objectIndex";
import { isNamespaceInScope, type ScopeOptions } from "../scope";
import { emptyOutput, type ScannerOutput } from "../types";
import type { ApprovalProcessInput, EmailAlertInput, SharingRuleInput, ValidationRuleInput, WorkflowRuleInput } from "./inputs";

// Components that hang off one object. Names are only unique within their object, so the fqn is
// `Object.Name`. The object is resolved through the in-scope index for the edge. A rule whose object is
// out of scope (or unresolvable) is still a node, as in the native app, just without a parent or an
// edge; `names` (every stored object, in scope or not) turns a TableEnumOrId Id into a readable name.

type ObjectBound = { objectName: string; name: string; sfId?: string | null; namespace?: string | null };

function scanBound<T extends ObjectBound>(
  items: T[],
  index: ObjectIndex,
  kind: "ValidationRule" | "WorkflowRule" | "EmailAlert" | "ApprovalProcess" | "SharingRule",
  edge: "VALIDATES" | "APPLIES_TO",
  describe: (item: T) => { label: string; attributes: Record<string, unknown> },
  options?: ScopeOptions,
  names?: ObjectIndex
): ScannerOutput {
  const out = emptyOutput();
  for (const item of items) {
    if (options && !isNamespaceInScope(item.namespace ?? null, options)) continue;
    const owner = index.resolve(item.objectName);
    const objectName = owner?.name ?? names?.resolve(item.objectName)?.name ?? (item.objectName || null);
    const { label, attributes } = describe(item);
    const { key, draft } = nodeDraft(kind, {
      fqn: objectName ? `${objectName}.${item.name}` : item.name,
      label,
      parentKey: owner?.nodeKey ?? null,
      namespace: item.namespace ?? null,
      attributes: { ...attributes, objectApiName: objectName },
    });
    out.nodes.push(draft);
    if (item.sfId) out.ids.push([item.sfId, key]);
    if (owner) out.edges.push(edgeDraft(edge, key, owner.nodeKey));
  }
  out.edges = dedupeEdges(out.edges);
  return out;
}

export const scanValidationRules = (rules: ValidationRuleInput[], index: ObjectIndex, options: ScopeOptions, names?: ObjectIndex) =>
  scanBound(
    rules,
    index,
    "ValidationRule",
    "VALIDATES",
    (r) => ({
      label: r.name,
      attributes: {
        active: r.active,
        description: r.description,
        errorConditionFormula: r.errorConditionFormula ?? null,
        errorDisplayField: r.errorDisplayField ?? null,
        errorMessage: r.errorMessage,
      },
    }),
    options,
    names
  );

// Workflow rules carry the package namespace from the metadata listing, so they follow the same
// namespace rule as every other automation component.
export const scanWorkflowRules = (rules: WorkflowRuleInput[], index: ObjectIndex, options?: ScopeOptions, names?: ObjectIndex) =>
  scanBound(
    rules,
    index,
    "WorkflowRule",
    "APPLIES_TO",
    (r) => ({ label: r.name, attributes: { active: r.active, description: r.description ?? null, triggerType: r.triggerType, formula: r.formula ?? null } }),
    options,
    names
  );

export const scanEmailAlerts = (alerts: EmailAlertInput[], index: ObjectIndex, options: ScopeOptions, names?: ObjectIndex) =>
  scanBound(
    alerts,
    index,
    "EmailAlert",
    "APPLIES_TO",
    (a) => ({ label: a.name, attributes: { description: a.description, ccEmails: a.ccEmails ?? null, senderType: a.senderType ?? null, templateId: a.templateId ?? null } }),
    options,
    names
  );

export const scanApprovalProcesses = (processes: ApprovalProcessInput[], index: ObjectIndex, options: ScopeOptions, names?: ObjectIndex) =>
  scanBound(processes, index, "ApprovalProcess", "APPLIES_TO", (p) => ({ label: p.label || p.name, attributes: { label: p.label, state: p.state, description: p.description } }), options, names);

// Sharing rules are read for in-scope objects only (native parity), so their object always resolves.
export const scanSharingRules = (rules: SharingRuleInput[], index: ObjectIndex) =>
  scanBound(rules, index, "SharingRule", "APPLIES_TO", (r) => ({
    label: r.details?.label || r.name,
    attributes: {
      ruleType: r.ruleType,
      accessLevel: r.accessLevel,
      label: r.details?.label ?? null,
      description: r.details?.description ?? null,
      sharedTo: r.details?.sharedTo ?? null,
      sharedFrom: r.details?.sharedFrom ?? null,
      accountSettings: r.details?.accountSettings ?? null,
      booleanFilter: r.details?.booleanFilter ?? null,
      criteriaItems: r.details?.criteriaItems ?? null,
      includeRecordsOwnedByAll: r.details?.includeRecordsOwnedByAll ?? null,
      includeHVUOwnedRecords: r.details?.includeHVUOwnedRecords ?? null,
    },
  }));
