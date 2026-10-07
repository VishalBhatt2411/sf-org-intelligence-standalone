import type { OrgWideDefault, SharingRule, UserRole } from "@prisma/client";
import type { NewFinding } from "./codeQuality";

const OPEN_INTERNAL_MODELS = ["ReadWrite", "Public Read/Write"];
const SHARING_RULE_SPRAWL_THRESHOLD = 10;
const ROLE_HIERARCHY_DEPTH_THRESHOLD = 7;

function roleDepth(roleId: string, byId: Map<string, UserRole>, depthCache: Map<string, number>): number {
  const cached = depthCache.get(roleId);
  if (cached !== undefined) return cached;

  const role = byId.get(roleId);
  const depth = role?.parentRoleId && byId.has(role.parentRoleId) ? 1 + roleDepth(role.parentRoleId, byId, depthCache) : 0;
  depthCache.set(roleId, depth);
  return depth;
}

export function analyzeSharingSecurity(
  orgWideDefaults: OrgWideDefault[],
  sharingRules: SharingRule[],
  userRoles: UserRole[]
): NewFinding[] {
  const findings: NewFinding[] = [];

  for (const owd of orgWideDefaults) {
    if (OPEN_INTERNAL_MODELS.includes(owd.internalSharingModel)) {
      findings.push({
        category: "security",
        ruleKey: "owd_too_open",
        severity: "high",
        title: `${owd.apiName} org-wide default is ${owd.internalSharingModel}`,
        detail: "Every internal user can read and edit every record on this object by default; consider a more restrictive OWD plus explicit sharing rules.",
        componentType: "SfObject",
        componentName: owd.apiName,
      });
    }
    if (owd.externalSharingModel && OPEN_INTERNAL_MODELS.includes(owd.externalSharingModel)) {
      findings.push({
        category: "security",
        ruleKey: "owd_external_too_open",
        severity: "critical",
        title: `${owd.apiName} external org-wide default is ${owd.externalSharingModel}`,
        detail: "Portal/community/guest users get broad access to every record on this object by default — a common data-exposure vector.",
        componentType: "SfObject",
        componentName: owd.apiName,
      });
    }
  }

  const rulesByObject = new Map<string, SharingRule[]>();
  for (const rule of sharingRules) {
    rulesByObject.set(rule.objectName, [...(rulesByObject.get(rule.objectName) || []), rule]);
  }
  for (const [objectName, rules] of rulesByObject) {
    if (rules.length > SHARING_RULE_SPRAWL_THRESHOLD) {
      findings.push({
        category: "security",
        ruleKey: "sharing_rule_sprawl",
        severity: "medium",
        title: `${objectName} has ${rules.length} sharing rules`,
        detail: `Exceeds ${SHARING_RULE_SPRAWL_THRESHOLD} sharing rules, making the effective access model hard to reason about and audit.`,
        componentType: "SfObject",
        componentName: objectName,
      });
    }
  }

  const rolesById = new Map(userRoles.map((r) => [r.sfId || r.id, r]));
  const depthCache = new Map<string, number>();
  let deepestRole: UserRole | null = null;
  let deepestDepth = -1;
  for (const role of userRoles) {
    const depth = roleDepth(role.sfId || role.id, rolesById, depthCache);
    if (depth > deepestDepth) {
      deepestDepth = depth;
      deepestRole = role;
    }
  }
  if (deepestRole && deepestDepth > ROLE_HIERARCHY_DEPTH_THRESHOLD) {
    findings.push({
      category: "security",
      ruleKey: "deep_role_hierarchy",
      severity: "medium",
      title: `Role hierarchy is ${deepestDepth + 1} levels deep`,
      detail: `Deepest branch reaches "${deepestRole.name}". Exceeds ${ROLE_HIERARCHY_DEPTH_THRESHOLD} levels, which slows record roll-up visibility and complicates access reviews.`,
      componentType: "UserRole",
      componentName: deepestRole.name,
    });
  }

  return findings;
}
