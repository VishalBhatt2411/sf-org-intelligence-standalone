import { dedupeEdges, edgeDraft, nodeDraft } from "../draft";
import type { ObjectIndex } from "../objectIndex";
import { emptyOutput, type ScannerOutput } from "../types";
import type { FlowInput } from "./inputs";

// Flows: one node each, EXECUTES_ON the object a record-triggered flow is bound to. Screen flows and
// autolaunched flows have no object and so no edge. The object comes straight from the flow's own
// definition (exact); one outside the in-scope set gets no edge rather than a dangling one.
export function scanFlows(flows: FlowInput[], index: ObjectIndex): ScannerOutput {
  const out = emptyOutput();
  for (const flow of flows) {
    const target = index.resolve(flow.objectName);
    const { key, draft } = nodeDraft("Flow", {
      fqn: flow.apiName,
      label: flow.label || flow.apiName,
      attributes: { status: flow.status, triggerType: flow.triggerType, objectApiName: target?.name ?? flow.objectName },
    });
    out.nodes.push(draft);
    if (flow.sfId) out.ids.push([flow.sfId, key]);
    if (target) out.edges.push(edgeDraft("EXECUTES_ON", key, target.nodeKey, { attributes: { triggerType: flow.triggerType } }));
  }
  out.edges = dedupeEdges(out.edges);
  return out;
}
