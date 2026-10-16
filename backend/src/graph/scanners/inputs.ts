// Plain input shapes the pure scanners consume. They are deliberately free of Prisma and jsforce
// types: loaders (graphInputs.ts, graphSource.ts) adapt stored rows and live queries to these, so a
// scanner can be tested with literals and never touches I/O.

export type ObjectInput = {
  apiName: string;
  label: string;
  sfId: string | null;
  // The rest of the native OI_ObjectScanner attribute set (describeGlobal plus the stored field list).
  // Optional so scanner tests can build objects from literals.
  details?: ObjectDetails;
};

export type ObjectDetails = {
  pluralLabel: string | null;
  keyPrefix: string | null;
  queryable: boolean;
  createable: boolean;
  updateable: boolean;
  deletable: boolean;
  feedEnabled: boolean;
  fieldCount: number;
  customFieldCount: number;
};

export type DescribedField = {
  name: string;
  label: string;
  type: string;
  referenceTo: string[] | null;
  // True for master-detail relationships (describe reports a relationshipOrder only for those).
  masterDetail: boolean;
  sfId: string | null;
  // Read live for the Intelligence Panel only; the scanners never need them, so they stay optional.
  custom?: boolean;
  // A relationship field the user must fill in (not nillable, or master-detail).
  required?: boolean;
  cascadeDelete?: boolean;
  relationshipName?: string | null;
  // The rest of the native OI_FieldScanner attribute set, stored on the field node for the Intelligence
  // Panel's Technical Details. Optional so scanner tests can build fields from literals.
  details?: FieldDetails;
};

export type FieldDetails = {
  length: number | null;
  precision: number | null;
  scale: number | null;
  nillable: boolean;
  unique: boolean;
  externalId: boolean;
  calculated: boolean;
  createable: boolean;
  updateable: boolean;
};

export type DescribedObject = { name: string; fields: DescribedField[] };

// What Tooling ApexClass / ApexTrigger say about a unit besides its body (native attribute set). Absent
// for rows stored before it was captured.
export type ApexMeta = {
  namespace: string | null;
  status: string | null;
  isValid: boolean | null;
  bodyCrc: number | null;
  lengthWithoutComments: number | null;
  apiVersion: number | null;
};

// `body` is "" for a class whose source the API does not return (managed or hidden).
export type ApexClassInput = { name: string; sfId: string | null; body: string; lineCount: number; apiVersion?: number | null; meta?: ApexMeta };

// `objectName` is TableEnumOrId: an object name for standard objects, a record Id for custom ones.
export type ApexTriggerInput = { name: string; sfId: string | null; objectName: string; body: string; meta?: ApexMeta };

export type FlowInput = {
  apiName: string;
  label: string;
  status: string;
  triggerType: string | null;
  objectName: string | null;
  sfId: string | null;
  // From the stored Metadata API definition.
  processType?: string | null;
  description?: string | null;
  // Package namespace (FlowDefinitionView.NamespacePrefix, else the "ns__" prefix of the API name).
  namespace?: string | null;
};

// One FlowDefinitionView row: the native OI_FlowScanner's source.
export type FlowDefinitionMeta = {
  apiName: string;
  label: string | null;
  description: string | null;
  processType: string | null;
  triggerType: string | null;
  triggerObjectOrEventId: string | null;
  isActive: boolean;
  versionNumber: number | null;
  namespace: string | null;
  manageableState: string | null;
};

// permJson is the Metadata API representation, so booleans may arrive as strings and single
// elements may not be wrapped in an array.
export type PermissionSetInput = { name: string; sfId: string | null; permJson: unknown };

// What the PermissionSet sObject says about a set (the metadata read has none of it).
export type PermissionSetMeta = {
  name: string;
  label: string | null;
  isCustom: boolean;
  type: string | null;
  namespace: string | null;
  description?: string | null;
  license?: string | null;
  // A profile's shadow set; never a node (native filters IsOwnedByProfile = FALSE).
  isOwnedByProfile?: boolean;
};

// objectName is "" when the Tooling API could not resolve the rule's object; the rule is still a node.
export type ValidationRuleInput = {
  sfId: string | null;
  objectName: string;
  name: string;
  active: boolean;
  description: string | null;
  errorMessage: string | null;
  namespace: string | null;
  // From the Metadata API read (the Tooling API only returns them one rule per query).
  errorConditionFormula?: string | null;
  errorDisplayField?: string | null;
};

// Metadata API ValidationRule details keyed by "Object.Rule".
export type ValidationRuleDetails = { errorConditionFormula: string | null; errorDisplayField: string | null };

export type EmailAlertInput = {
  sfId: string | null;
  objectName: string;
  name: string;
  description: string | null;
  namespace: string | null;
  ccEmails?: unknown;
  senderType?: string | null;
  templateId?: string | null;
};

// `objectName` is TableEnumOrId (a name for standard objects, an Id for custom ones).
export type ApprovalProcessInput = {
  sfId: string | null;
  objectName: string;
  name: string;
  label: string;
  state: string | null;
  description: string | null;
  namespace: string | null;
};

export type WorkflowRuleInput = {
  sfId: string | null;
  objectName: string;
  name: string;
  active: boolean;
  triggerType: string | null;
  description?: string | null;
  formula?: string | null;
  namespace?: string | null;
};

// ruleType is the native metadata label: SharingCriteriaRule, SharingGuestRule, SharingOwnerRule or
// SharingTerritoryRule. `details` is the rest of the Metadata API rule, when the scan captured it.
export type SharingRuleInput = { objectName: string; name: string; ruleType: string; accessLevel: string; details?: SharingRuleDetails };

export type SharingRuleDetails = {
  label: string | null;
  description: string | null;
  sharedTo: unknown;
  sharedFrom: unknown;
  accountSettings: unknown;
  booleanFilter: string | null;
  criteriaItems: unknown;
  includeRecordsOwnedByAll: unknown;
  includeHVUOwnedRecords: unknown;
};

export type DependencyInput = {
  componentId: string;
  componentName: string;
  componentType: string;
  refComponentId: string;
  refComponentName: string;
  refComponentType: string;
};

// A stored field, looked up by Id so a dependency on it can be placed under the right object.
export type StoredFieldInfo = { objectName: string; fieldName: string; label: string; type: string };
