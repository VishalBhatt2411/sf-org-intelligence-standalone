import { dedupeEdges, edgeDraft, nodeDraft } from "../draft";
import type { ObjectIndex } from "../objectIndex";
import { isNamespaceInScope, type ScopeOptions } from "../scope";
import { emptyOutput, type ScannerOutput } from "../types";
import type { FlowDefinitionMeta, FlowInput } from "./inputs";

// Process Builder processes are Flow metadata with processType "Workflow"; subType tells them apart.
export function flowSubType(processType: string | null | undefined): "ProcessBuilder" | "Flow" {
  return processType === "Workflow" ? "ProcessBuilder" : "Flow";
}

// Flow API names cannot contain "__", so one in a stored name is the package prefix ("ns__Flow").
function namespaceFromFlowName(apiName: string): string | null {
  const at = apiName.indexOf("__");
  return at > 0 ? apiName.slice(0, at) : null;
}

// FlowDefinitionView names a managed flow by ApiName plus NamespacePrefix; the Metadata API listing
// uses "ns__ApiName". Both spellings index the same row.
export function flowDefinitionIndex(rows: FlowDefinitionMeta[]): Map<string, FlowDefinitionMeta> {
  const out = new Map<string, FlowDefinitionMeta>();
  for (const row of rows) {
    out.set(row.apiName.toLowerCase(), row);
    if (row.namespace) out.set(`${row.namespace}__${row.apiName}`.toLowerCase(), row);
  }
  return out;
}

// Flows: one node each, EXECUTES_ON the object a record-triggered flow is bound to. Screen flows and
// autolaunched flows have no object and so no edge. The object comes straight from the flow's own
// definition (exact); one outside the in-scope set gets no edge rather than a dangling one.
// Attributes follow the native OI_FlowScanner (FlowDefinitionView) set when `definitions` is given;
// a flow of another package is skipped unless managed packages are scanned, as for every component.
export function scanFlows(flows: FlowInput[], index: ObjectIndex, options?: ScopeOptions, definitions?: ReadonlyMap<string, FlowDefinitionMeta>): ScannerOutput {
  const out = emptyOutput();
  for (const flow of flows) {
    const def = definitions?.get(flow.apiName.toLowerCase());
    const namespace = def ? def.namespace : (flow.namespace ?? namespaceFromFlowName(flow.apiName));
    if (options && !isNamespaceInScope(namespace, options)) continue;
    const apiName = def?.apiName ?? (namespace && flow.apiName.startsWith(`${namespace}__`) ? flow.apiName.slice(namespace.length + 2) : flow.apiName);
    const target = index.resolve(flow.objectName) ?? index.resolve(def?.triggerObjectOrEventId);
    const triggerType = flow.triggerType ?? def?.triggerType ?? null;
    const processType = def?.processType ?? flow.processType ?? null;
    const objectApiName = target?.name ?? flow.objectName;
    const { key, draft } = nodeDraft("Flow", {
      // Native fqn: "ns.ApiName" for a packaged flow.
      fqn: namespace ? `${namespace}.${apiName}` : flow.apiName,
      label: def?.label || flow.label || flow.apiName,
      namespace,
      attributes: {
        label: def?.label ?? flow.label,
        description: def?.description ?? flow.description ?? null,
        status: flow.status,
        processType,
        subType: flowSubType(processType),
        triggerType,
        isActive: def ? def.isActive : flow.status === "Active",
        versionNumber: def?.versionNumber ?? null,
        manageableState: def?.manageableState ?? null,
        objectApiName,
        triggerObjectApiName: objectApiName ?? def?.triggerObjectOrEventId ?? null,
      },
    });
    out.nodes.push(draft);
    if (flow.sfId) out.ids.push([flow.sfId, key]);
    if (target) out.edges.push(edgeDraft("EXECUTES_ON", key, target.nodeKey, { attributes: { triggerType } }));
  }
  out.edges = dedupeEdges(out.edges);
  return out;
}
