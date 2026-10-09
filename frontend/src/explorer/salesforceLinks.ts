// Salesforce Setup deep links built from the connection's instance URL. The native app navigates inside
// Lightning; the standalone opens Setup in a new tab. Pure so it can be tested without a browser.

const base = (instanceUrl: string) => instanceUrl.replace(/\/+$/, "");

export const objectSetupUrl = (instanceUrl: string, objectApiName: string): string =>
  `${base(instanceUrl)}/lightning/setup/ObjectManager/${encodeURIComponent(objectApiName)}/Details/view`;

// Custom fields are addressed by id in Setup, which the graph does not carry, so the link lands on the
// object's Fields & Relationships list instead.
export const fieldsSetupUrl = (instanceUrl: string, objectApiName: string): string =>
  `${base(instanceUrl)}/lightning/setup/ObjectManager/${encodeURIComponent(objectApiName)}/FieldsAndRelationships/view`;

// "Account.OwnerId" -> "Account"; a bare name is returned as is.
export const objectOfField = (fieldFqn: string): string => fieldFqn.split(".")[0];
