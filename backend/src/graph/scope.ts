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
  // Number of in-scope "__c" fields (managed fields of another package excluded, see
  // isFieldNamespaceInScope), from the stored scan. Decides whether a standard object is "customized".
  customFieldCount: number;
};

export type ScopeOptions = {
  settings: Pick<GraphSettings, "scanManagedPackageObjects" | "scanCustomizedStandardObjects"> &
    Partial<Pick<GraphSettings, "alwaysIncludeObjects" | "alwaysExcludeObjects">>;
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

// Native OI_ObjectScopeFilter.isForeignNamespaced: after stripping the org's own "ns__" prefix, a name
// with more than one "__" (ns__Field__c, ns__Object__c) belongs to another package. Field__c, Name and
// the org's own ns__Field__c are local.
export function isForeignNamespaced(apiName: string, orgNamespace: string | null): boolean {
  let name = apiName;
  if (orgNamespace && name.toLowerCase().startsWith(`${orgNamespace.toLowerCase()}__`)) name = name.slice(orgNamespace.length + 2);
  return name.indexOf("__") !== name.lastIndexOf("__");
}

// A field of another managed package is only scanned when managed packages are.
export function isFieldNamespaceInScope(fieldName: string, { settings, orgNamespace }: ScopeOptions): boolean {
  return settings.scanManagedPackageObjects || !isForeignNamespaced(fieldName, orgNamespace);
}

const listed = (names: readonly string[] | undefined, name: string) => !!names && names.some((n) => n.toLowerCase() === name.toLowerCase());

// Native order: structurally ineligible (not queryable, or a companion/non-record suffix) never; then the
// always-exclude list; then always-include (the shipped standard allowlist plus the setting); then the
// custom/standard rules.
export function isObjectInScope(candidate: ObjectCandidate, options: ScopeOptions): boolean {
  if (!candidate.queryable) return false;
  if (hasNoiseSuffix(candidate.name)) return false;
  if (listed(options.settings.alwaysExcludeObjects, candidate.name)) return false;
  if (listed(options.settings.alwaysIncludeObjects, candidate.name)) return true;
  if (candidate.custom) return isNamespaceInScope(namespaceFromApiName(candidate.name), options);
  if (STANDARD_OBJECT_ALLOWLIST.includes(candidate.name)) return true;
  return options.settings.scanCustomizedStandardObjects && candidate.customFieldCount > 0;
}

// Every reference field is a candidate, system audit fields (OwnerId, CreatedById, LastModifiedById)
// included, exactly as the native OI_FieldScanner persists them. The explorer, not the scan, decides
// whether to show them (Object mode's Business / System / All view).
export function isRelationshipFieldCandidate(field: { name: string; type: string; referenceTo: string[] | null }): boolean {
  if (field.type !== "reference") return false;
  return !!field.referenceTo && field.referenceTo.length > 0;
}
