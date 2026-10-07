import { prisma } from "../prisma";
import { analyzeCodeQuality } from "./codeQuality";
import { analyzeAutomation } from "./automation";
import { analyzeArchitecture } from "./architecture";
import { analyzeSecurity } from "./security";
import { analyzeSharingSecurity } from "./sharingSecurity";
import { analyzeDataQuality } from "./dataQuality";
import { analyzeGovernorLimits } from "./governorLimits";

export async function runAnalysis(scanId: string) {
  const [
    classes,
    triggers,
    flows,
    objects,
    fields,
    profiles,
    permissionSets,
    dependencies,
    lwcComponents,
    orgWideDefaults,
    sharingRules,
    userRoles,
  ] = await Promise.all([
    prisma.apexClass.findMany({ where: { scanId } }),
    prisma.apexTrigger.findMany({ where: { scanId } }),
    prisma.flow.findMany({ where: { scanId } }),
    prisma.sfObject.findMany({ where: { scanId } }),
    prisma.sfField.findMany({ where: { object: { scanId } } }),
    prisma.profile.findMany({ where: { scanId } }),
    prisma.permissionSet.findMany({ where: { scanId } }),
    prisma.componentDependency.findMany({ where: { scanId } }),
    prisma.lwcComponent.findMany({ where: { scanId } }),
    prisma.orgWideDefault.findMany({ where: { scanId } }),
    prisma.sharingRule.findMany({ where: { scanId } }),
    prisma.userRole.findMany({ where: { scanId } }),
  ]);

  const findings = [
    ...analyzeCodeQuality(classes, triggers),
    ...analyzeAutomation(flows, triggers),
    ...analyzeArchitecture(objects, triggers, flows, fields, dependencies),
    ...analyzeSecurity(profiles, permissionSets),
    ...analyzeSharingSecurity(orgWideDefaults, sharingRules, userRoles),
    ...analyzeDataQuality(objects, fields, classes, triggers, flows, lwcComponents, dependencies),
    ...analyzeGovernorLimits(classes, triggers),
  ];

  await prisma.finding.createMany({
    data: findings.map((f) => ({ scanId, ...f })),
  });

  return findings.length;
}

const SEVERITY_WEIGHT: Record<string, number> = { low: 1, medium: 2, high: 5, critical: 10 };
export const DEBT_CATEGORIES = [
  "code_quality",
  "automation",
  "security",
  "architecture",
  "data_quality",
  "governor_limits",
] as const;

export async function computeHealthScore(scanId: string) {
  const findings = await prisma.finding.findMany({ where: { scanId } });

  const categoryScores: Record<string, number> = {};
  for (const category of DEBT_CATEGORIES) {
    const deduction = findings
      .filter((f) => f.category === category)
      .reduce((sum, f) => sum + (SEVERITY_WEIGHT[f.severity] || 0), 0);
    categoryScores[category] = Math.max(0, 100 - deduction);
  }

  const overall = Math.round(
    Object.values(categoryScores).reduce((a, b) => a + b, 0) / DEBT_CATEGORIES.length
  );

  return { overall, categoryScores, totalFindings: findings.length };
}
