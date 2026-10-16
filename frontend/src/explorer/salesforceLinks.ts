// Salesforce Setup deep links built from the connection's instance URL. The native app navigates inside
// Lightning; the standalone opens Setup in a new tab. Pure so it can be tested without a browser.

const base = (instanceUrl: string) => instanceUrl.replace(/\/+$/, "");

export const objectSetupUrl = (instanceUrl: string, objectApiName: string): string =>
  `${base(instanceUrl)}/lightning/setup/ObjectManager/${encodeURIComponent(objectApiName)}/Details/view`;

// Custom fields are addressed by id in Setup, which the graph does not carry, so the link lands on the
// object's Fields & Relationships list instead.
export const fieldsSetupUrl = (instanceUrl: string, objectApiName: string): string =>
  `${base(instanceUrl)}/lightning/setup/ObjectManager/${encodeURIComponent(objectApiName)}/FieldsAndRelationships/view`;

// A record's own detail page.
export const recordUrl = (instanceUrl: string, objectApiName: string, recordId: string): string =>
  `${base(instanceUrl)}/lightning/r/${encodeURIComponent(objectApiName)}/${encodeURIComponent(recordId)}/view`;

// "Account.OwnerId" -> "Account"; a bare name is returned as is.
export const objectOfField = (fieldFqn: string): string => fieldFqn.split(".")[0];

// Setup navigation for any metadata node (port of native OI_MetadataNavigationService). Native resolves
// Salesforce ids (EntityDefinition / FieldDefinition DurableId, ApexClass Id, ...) on the server. The graph
// only carries ids when a node's attributes include one (`sfId`, `durableId` or `id`), so without one the link
// falls back to the closest Setup list page and says so in `caveat`.
export type MetadataNodeRef = { kind: string; fqn: string; label?: string; attributes?: Record<string, unknown> };
export type SetupTarget = { url: string; label: string; caveat?: string } | { url: null; reason: string };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
// Namespace-qualified names keep only the last segment, as native's substringAfterLast('.').
const unqualified = (name: string) => name.slice(name.lastIndexOf(".") + 1);
const idOf = (attrs: Record<string, unknown> | undefined) => str(attrs?.sfId) ?? str(attrs?.durableId) ?? str(attrs?.id);
const isCustomName = (name: string) => /__[a-z]+$/i.test(name);
const pageAddress = (instanceUrl: string, area: string, id: string) => `${base(instanceUrl)}/lightning/setup/${area}/page?address=${encodeURIComponent(`/${id}`)}`;
const home = (instanceUrl: string, area: string) => `${base(instanceUrl)}/lightning/setup/${area}/home`;

const NO_ID = "The scan did not record this component's Salesforce id, so this opens the list where you can select it.";
const FLOW_CAVEAT = "Salesforce does not expose a stable direct link to a single Flow without Tooling API access, so this opens the Flows list where you can select it.";

// "OwnerId" -> "Owner", the suffix Setup uses for a standard relationship field.
const standardFieldSuffix = (fieldName: string, attrs: Record<string, unknown> | undefined) => {
  const relationshipName = str(attrs?.relationshipName);
  if (relationshipName && (attrs?.relationship || attrs?.referenceTo)) return relationshipName;
  return fieldName;
};

export function metadataSetupTarget(instanceUrl: string, node: MetadataNodeRef): SetupTarget {
  const attrs = node.attributes;
  const id = idOf(attrs);
  const objectOf = () => str(attrs?.objectApiName) ?? objectOfField(node.fqn);
  switch (node.kind) {
    case "CustomObject":
      return { url: objectSetupUrl(instanceUrl, id ?? node.fqn), label: "Open in Setup" };
    case "CustomField": {
      const object = objectOfField(node.fqn);
      const field = node.fqn.slice(object.length + 1) || node.fqn;
      const custom = attrs?.custom === true || isCustomName(field);
      // A DurableId is "<entity>.<suffix>"; Setup wants the suffix.
      const suffix = id ? id.slice(id.lastIndexOf(".") + 1) : custom ? null : standardFieldSuffix(field, attrs);
      if (!suffix) return { url: fieldsSetupUrl(instanceUrl, object), label: "Open in Setup", caveat: "Custom fields open by id in Setup and the scan did not record it, so this opens the object's Fields & Relationships list." };
      return { url: `${base(instanceUrl)}/lightning/setup/ObjectManager/${encodeURIComponent(object)}/FieldsAndRelationships/${encodeURIComponent(suffix)}/view`, label: "Open in Setup" };
    }
    case "ApexClass":
      return id ? { url: pageAddress(instanceUrl, "ApexClasses", id), label: "Open in Setup" } : { url: home(instanceUrl, "ApexClasses"), label: "Open Apex Classes", caveat: NO_ID };
    case "ApexTrigger":
      return id ? { url: pageAddress(instanceUrl, "ApexTriggers", id), label: "Open in Setup" } : { url: home(instanceUrl, "ApexTriggers"), label: "Open Apex Triggers", caveat: NO_ID };
    case "PermissionSet":
      return id ? { url: pageAddress(instanceUrl, "PermSets", id), label: "Open in Setup" } : { url: home(instanceUrl, "PermSets"), label: "Open Permission Sets", caveat: NO_ID };
    case "Flow":
      return { url: home(instanceUrl, "Flows"), label: "Open Flows", caveat: FLOW_CAVEAT };
    case "ValidationRule": {
      const object = objectOf();
      const list = `${base(instanceUrl)}/lightning/setup/ObjectManager/${encodeURIComponent(object)}/ValidationRules`;
      return id ? { url: `${list}/${encodeURIComponent(id)}/view`, label: "Open in Setup" } : { url: `${list}/view`, label: "Open Validation Rules", caveat: NO_ID };
    }
    case "WorkflowRule":
      return { url: home(instanceUrl, "WorkflowRules"), label: "Open Workflow Rules", caveat: NO_ID };
    case "EmailAlert":
      return { url: home(instanceUrl, "WorkflowEmails"), label: "Open Email Alerts", caveat: NO_ID };
    case "ApprovalProcess":
      return { url: home(instanceUrl, "ApprovalProcesses"), label: "Open Approval Processes", caveat: NO_ID };
    case "SharingRule":
      return { url: home(instanceUrl, "SecuritySharing"), label: "Open Sharing Settings", caveat: NO_ID };
    default:
      return { url: null, reason: `Opening ${node.kind || unqualified(node.fqn)} components is not supported yet.` };
  }
}
