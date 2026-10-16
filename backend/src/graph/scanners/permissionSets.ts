import { dedupeEdges, edgeDraft, nodeDraft } from "../draft";
import type { ObjectIndex } from "../objectIndex";
import { isNamespaceInScope, type ScopeOptions } from "../scope";
import type { GraphSettings } from "../settings";
import { emptyOutput, type ScannerOutput } from "../types";
import type { PermissionSetInput, PermissionSetMeta } from "./inputs";

export type PermissionScopeOptions = {
  settings: ScopeOptions["settings"] & Pick<GraphSettings, "scanStandardPermissionSets">;
  orgNamespace: string | null;
};

// permJson is Metadata API output: a single element is not wrapped in an array and booleans can be
// the string "true".
const asArray = <T>(value: T | T[] | null | undefined): T[] => (value == null ? [] : Array.isArray(value) ? value : [value]);
const isTrue = (value: unknown): boolean => value === true || value === "true";
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

// Flags in the order the original app reported them, so grantedPermissions reads the same.
const OBJECT_FLAGS: Array<[flag: string, label: string]> = [
  ["allowRead", "read"],
  ["allowCreate", "create"],
  ["allowEdit", "edit"],
  ["allowDelete", "delete"],
  ["viewAllRecords", "view all"],
  ["modifyAllRecords", "modify all"],
];

// Permission set API names carry their package as a "ns__Name" prefix (two segments, unlike fields).
const namespaceFromSetName = (name: string): string | null => (name.includes("__") ? name.slice(0, name.indexOf("__")) || null : null);

// Mirrors the original scope rule. Group shadow sets are never managed by an admin; Salesforce-
// supplied sets (not custom) need the explicit setting; the rest follow the namespace rule.
// A set with no live metadata row is treated as a custom one, with the namespace read from its name.
export function isPermissionSetInScope(name: string, meta: PermissionSetMeta | undefined, options: PermissionScopeOptions): boolean {
  if (meta?.isOwnedByProfile) return false;
  if (meta?.type === "Group") return false;
  if (meta && !meta.isCustom && !options.settings.scanStandardPermissionSets) return false;
  return isNamespaceInScope(meta ? meta.namespace || null : namespaceFromSetName(name), options);
}

// The PermissionSet sObject names a packaged set "Name" + NamespacePrefix; the Metadata API listing
// calls it "ns__Name". Both spellings index the same row.
export function permissionSetMetaIndex(rows: PermissionSetMeta[]): Map<string, PermissionSetMeta> {
  const out = new Map<string, PermissionSetMeta>();
  for (const row of rows) {
    if (row.isOwnedByProfile) continue;
    out.set(row.name, row);
    if (row.namespace) out.set(`${row.namespace}__${row.name}`, row);
  }
  return out;
}

// Permission sets: one node each, GRANTS_ACCESS_TO the objects they give any CRUD/view-all access to
// and the Apex classes they enable. A grant row with every flag off confers nothing, so it is not an
// edge. Field-level grants are deliberately not scanned (volume), exactly as in the original.
export function scanPermissionSets(
  sets: PermissionSetInput[],
  metaByName: ReadonlyMap<string, PermissionSetMeta>,
  index: ObjectIndex,
  classKeys: ReadonlyMap<string, string>,
  options: PermissionScopeOptions
): ScannerOutput {
  const out = emptyOutput();
  for (const set of sets) {
    const meta = metaByName.get(set.name);
    if (!isPermissionSetInScope(set.name, meta, options)) continue;

    // Native fqn: "ns.Name" for a packaged set (the Metadata API's "ns__Name" re-spelled).
    const namespace = meta ? meta.namespace || null : namespaceFromSetName(set.name);
    const bareName = meta?.name ?? (namespace ? set.name.slice(namespace.length + 2) : set.name);
    const { key, draft } = nodeDraft("PermissionSet", {
      fqn: namespace ? `${namespace}.${bareName}` : set.name,
      label: meta?.label || set.name,
      namespace: meta || namespace ? namespace : undefined,
      attributes: {
        label: meta?.label ?? set.name,
        description: meta?.description ?? null,
        isCustom: meta?.isCustom ?? true,
        license: meta?.license ?? null,
      },
    });
    out.nodes.push(draft);
    if (set.sfId) out.ids.push([set.sfId, key]);

    const perms = record(set.permJson);
    for (const raw of asArray(perms.objectPermissions)) {
      const grant = record(raw);
      const target = typeof grant.object === "string" ? index.resolve(grant.object) : null;
      if (!target) continue;
      const granted = OBJECT_FLAGS.filter(([flag]) => isTrue(grant[flag])).map(([, label]) => label);
      if (granted.length === 0) continue;
      out.edges.push(edgeDraft("GRANTS_ACCESS_TO", key, target.nodeKey, { attributes: { grantedPermissions: granted } }));
    }
    for (const raw of asArray(perms.classAccesses)) {
      const access = record(raw);
      if (!isTrue(access.enabled) || typeof access.apexClass !== "string") continue;
      // The Metadata API may qualify a managed class as "ns.Class"; the stored class carries one name.
      const name = access.apexClass.toLowerCase();
      const classKey = classKeys.get(name) ?? classKeys.get(name.slice(name.lastIndexOf(".") + 1));
      if (!classKey) continue;
      out.edges.push(edgeDraft("GRANTS_ACCESS_TO", key, classKey, { attributes: { grantedPermissions: ["execute"] } }));
    }
  }
  out.edges = dedupeEdges(out.edges);
  return out;
}
