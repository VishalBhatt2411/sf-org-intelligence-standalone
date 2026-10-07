import type { Flow, ApexTrigger } from "@prisma/client";
import type { NewFinding } from "./codeQuality";

const SPRAWL_THRESHOLD = 3;

export function analyzeAutomation(flows: Flow[], triggers: ApexTrigger[]): NewFinding[] {
  const findings: NewFinding[] = [];

  for (const flow of flows) {
    if (flow.status !== "Active") {
      findings.push({
        category: "automation",
        ruleKey: "inactive_flow",
        severity: "low",
        title: `Inactive flow: ${flow.label}`,
        detail: `Status is "${flow.status}". Inactive flows are safe to remove if no longer needed.`,
        componentType: "Flow",
        componentName: flow.apiName,
      });
    }
  }

  const byObjectAndTrigger = new Map<string, Flow[]>();
  for (const flow of flows) {
    if (!flow.objectName) continue;
    const key = `${flow.objectName}:${flow.triggerType || "none"}`;
    byObjectAndTrigger.set(key, [...(byObjectAndTrigger.get(key) || []), flow]);
  }
  for (const [key, group] of byObjectAndTrigger) {
    if (group.length < 2) continue;
    const [objectName] = key.split(":");
    for (const flow of group) {
      findings.push({
        category: "automation",
        ruleKey: "duplicate_flow",
        severity: "medium",
        title: `Possible duplicate flow logic on ${objectName}`,
        detail: `${group.length} flows share the same object/trigger type: ${group.map((f) => f.label).join(", ")}.`,
        componentType: "Flow",
        componentName: flow.apiName,
      });
    }
  }

  const automationCountByObject = new Map<string, number>();
  for (const flow of flows) {
    if (!flow.objectName) continue;
    automationCountByObject.set(flow.objectName, (automationCountByObject.get(flow.objectName) || 0) + 1);
  }
  for (const trigger of triggers) {
    automationCountByObject.set(
      trigger.objectName,
      (automationCountByObject.get(trigger.objectName) || 0) + 1
    );
  }
  for (const [objectName, count] of automationCountByObject) {
    if (count > SPRAWL_THRESHOLD) {
      findings.push({
        category: "automation",
        ruleKey: "automation_sprawl",
        severity: "medium",
        title: `Automation sprawl on ${objectName}`,
        detail: `${count} flows/triggers fire on this object, making execution order hard to reason about.`,
        componentType: "SfObject",
        componentName: objectName,
      });
    }
  }

  return findings;
}
