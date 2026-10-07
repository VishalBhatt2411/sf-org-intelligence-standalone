import type { Profile, PermissionSet } from "@prisma/client";
import type { NewFinding } from "./codeQuality";

const BROAD_FIELD_EDIT_THRESHOLD = 50;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function checkAccessRecord(componentType: string, name: string, json: any): NewFinding[] {
  const findings: NewFinding[] = [];

  const userPermissions = asArray<any>(json?.userPermissions).filter((p) => p.enabled !== false);
  const permNames = userPermissions.map((p) => p.name);
  const riskyPerms = ["ModifyAllData", "ViewAllData", "AuthorApex", "ManageUsers"];
  const grantedRisky = permNames.filter((p) => riskyPerms.includes(p));
  if (grantedRisky.length > 0) {
    findings.push({
      category: "security",
      ruleKey: "over_permissioned",
      severity: "high",
      title: `${name} grants broad org-wide permissions`,
      detail: `Grants: ${grantedRisky.join(", ")}. Review whether this scope is actually needed.`,
      componentType,
      componentName: name,
    });
  }

  const isGuestLike = /guest/i.test(name);
  const objectPerms = asArray<any>(json?.objectPermissions);
  const broadObjectAccess = objectPerms.filter((p) => p.allowEdit === "true" || p.allowEdit === true || p.allowDelete === "true" || p.allowDelete === true);
  if (isGuestLike && broadObjectAccess.length > 0) {
    findings.push({
      category: "security",
      ruleKey: "guest_user_risk",
      severity: "critical",
      title: `Guest profile "${name}" has write access to ${broadObjectAccess.length} object(s)`,
      detail: `Guest users are unauthenticated; edit/delete access is a common breach vector: ${broadObjectAccess
        .map((p) => p.object)
        .join(", ")}.`,
      componentType,
      componentName: name,
    });
  }

  const fieldPerms = asArray<any>(json?.fieldPermissions);
  const editableFields = fieldPerms.filter((p) => p.editable === "true" || p.editable === true);
  if (editableFields.length > BROAD_FIELD_EDIT_THRESHOLD) {
    findings.push({
      category: "security",
      ruleKey: "fls_broad_edit",
      severity: "medium",
      title: `${name} grants edit access to ${editableFields.length} fields`,
      detail: "Broad field-level edit access increases risk of unintended data changes; consider narrowing scope.",
      componentType,
      componentName: name,
    });
  }

  return findings;
}

export function analyzeSecurity(profiles: Profile[], permissionSets: PermissionSet[]): NewFinding[] {
  return [
    ...profiles.flatMap((p) => checkAccessRecord("Profile", p.name, p.permJson)),
    ...permissionSets.flatMap((p) => checkAccessRecord("PermissionSet", p.name, p.permJson)),
  ];
}
