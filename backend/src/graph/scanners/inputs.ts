// Plain input shapes the pure scanners consume. They are deliberately free of Prisma and jsforce
// types: loaders (graphInputs.ts, graphSource.ts) adapt stored rows and live queries to these, so a
// scanner can be tested with literals and never touches I/O.

export type ObjectInput = { apiName: string; label: string; sfId: string | null };

export type DescribedField = {
  name: string;
  label: string;
  type: string;
  referenceTo: string[] | null;
  // True for master-detail relationships (describe reports a relationshipOrder only for those).
  masterDetail: boolean;
  sfId: string | null;
};

export type DescribedObject = { name: string; fields: DescribedField[] };

export type ApexClassInput = { name: string; sfId: string | null; body: string; lineCount: number };

// `objectName` is TableEnumOrId: an object name for standard objects, a record Id for custom ones.
export type ApexTriggerInput = { name: string; sfId: string | null; objectName: string; body: string };

export type FlowInput = {
  apiName: string;
  label: string;
  status: string;
  triggerType: string | null;
  objectName: string | null;
  sfId: string | null;
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
};

export type ValidationRuleInput = {
  sfId: string | null;
  objectName: string;
  name: string;
  active: boolean;
  description: string | null;
  errorMessage: string | null;
  namespace: string | null;
};

export type EmailAlertInput = {
  sfId: string | null;
  objectName: string;
  name: string;
  description: string | null;
  namespace: string | null;
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

export type WorkflowRuleInput = { sfId: string | null; objectName: string; name: string; active: boolean; triggerType: string | null };

export type SharingRuleInput = { objectName: string; name: string; ruleType: string; accessLevel: string };

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
