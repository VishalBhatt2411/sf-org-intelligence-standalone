import { namespaceFromApiName } from "./keys";
import type { GraphSettings } from "./settings";

// Scope rules from ADR-0031 of the Salesforce-native app: the graph covers the objects an admin
// actually works with, not every sObject the API exposes.

// Auto-generated companions and non-record objects. Plain suffix match, like the original.
export const NOISE_OBJECT_SUFFIXES = ["__mdt", "__e", "__b", "__x", "History", "Share", "Feed", "ChangeEvent"] as const;

// Standard objects that are always in scope, even with no custom fields (the 20 shipped by the
// original app as enabled Scan Object Scope records).
export const STANDARD_OBJECT_ALLOWLIST: readonly string[] = [
  "Account",
  "Asset",
  "Campaign",
  "CampaignMember",
  "Case",
  "Contact",
  "Contract",
  "Event",
  "Lead",
  "Opportunity",
  "OpportunityLineItem",
  "Order",
  "OrderItem",
  "Pricebook2",
  "PricebookEntry",
  "Product2",
  "Quote",
  "QuoteLineItem",
  "Task",
  "User",
];

export type ObjectCandidate = {
  name: string;
  custom: boolean;
  queryable: boolean;
  // Number of "__c" fields, from the stored scan. Decides whether a standard object is "customized".
  customFieldCount: number;
};

export type ScopeOptions = {
  settings: Pick<GraphSettings, "scanManagedPackageObjects" | "scanCustomizedStandardObjects">;
  // Namespace prefix of the connected org itself (null if it has none). Components in it are local.
  orgNamespace: string | null;
};

export function hasNoiseSuffix(name: string): boolean {
  return NOISE_OBJECT_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

// True when a namespaced component belongs to the org itself or managed packages are included.
// An un-namespaced component is always local.
export function isNamespaceInScope(namespace: string | null, { settings, orgNamespace }: ScopeOptions): boolean {
  if (!namespace) return true;
  if (orgNamespace && namespace.toLowerCase() === orgNamespace.toLowerCase()) return true;
  return settings.scanManagedPackageObjects;
}

export function isObjectInScope(candidate: ObjectCandidate, options: ScopeOptions): boolean {
  if (!candidate.queryable) return false;
  if (hasNoiseSuffix(candidate.name)) return false;
  if (candidate.custom) return isNamespaceInScope(namespaceFromApiName(candidate.name), options);
  if (STANDARD_OBJECT_ALLOWLIST.includes(candidate.name)) return true;
  return options.settings.scanCustomizedStandardObjects && candidate.customFieldCount > 0;
}

// System fields every object carries. As relationship fields they would add one edge per object to
// User with no architectural meaning, so they are never materialised as field nodes.
const SYSTEM_RELATIONSHIP_FIELDS = new Set(["CreatedById", "LastModifiedById", "OwnerId"]);

export function isRelationshipFieldCandidate(field: { name: string; type: string; referenceTo: string[] | null }): boolean {
  if (field.type !== "reference") return false;
  if (!field.referenceTo || field.referenceTo.length === 0) return false;
  return !SYSTEM_RELATIONSHIP_FIELDS.has(field.name);
}
