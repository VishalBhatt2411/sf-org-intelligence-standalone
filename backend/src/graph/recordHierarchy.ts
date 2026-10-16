// Record analysis (port of native OI_RecordHierarchyService / OI_RecordSearchService): a live, never-persisted
// read of one record's parent lookups and child records. Records are never scanned into the metadata graph;
// this is a parallel read path that returns graph-shaped fragments. The Salesforce calls sit behind
// `RecordApi`, so the logic is tested without jsforce and runs as the connected user (sharing and FLS apply).

export type RecordGlobal = { name: string; keyPrefix: string | null; queryable: boolean };
export type RecordDescribeField = { name: string; type: string; nameField: boolean; referenceTo: string[] };
export type RecordChildRelationship = { childSObject: string; field: string; relationshipName: string | null };
// `custom` is optional so a describe that does not say falls back to the "__c" naming convention.
export type RecordDescribe = { name: string; queryable: boolean; custom?: boolean; fields: RecordDescribeField[]; childRelationships: RecordChildRelationship[] };

export interface RecordApi {
  describeGlobal(): Promise<RecordGlobal[]>;
  describe(name: string): Promise<RecordDescribe>;
  // One page of rows, enough for every bounded query here.
  query(soql: string): Promise<Array<Record<string, unknown>>>;
}

export type RecordSummary = { recordId: string; label: string; objectApiName: string };
export type RecordNode = { nodeKey: string; typeKey: string; label: string; objectApiName: string; recordId: string };
export type RecordEdge = { edgeKey: string; typeKey: string; source: string; target: string; viaField: string | null };
export type RecordOverview = { ownerName: string | null; createdDate: string | null; lastModifiedDate: string | null };
export type RecordFragment = { centerNodeKey: string | null; nodes: RecordNode[]; edges: RecordEdge[]; hasMore: boolean; overview: RecordOverview | null };

export class RecordInputError extends Error {}
export class RecordNotFoundError extends Error {}

export const RECORD_PARENT_EDGE = "SalesforceRecord.LOOKUP_TO";
export const RECORD_CHILD_EDGE = "SalesforceRecord.CHILD_OF";
export const MAX_SEARCH_RESULTS = 20;
export const MIN_QUERY_LENGTH = 2;
export const MAX_CHILDREN_PER_RELATIONSHIP = 10;
export const MAX_RELATIONSHIP_TYPES = 200;
export const CHILD_RELATIONSHIP_BATCH = 20;
const DESCRIBE_CONCURRENCY = 6;

const API_NAME = /^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const RECORD_ID = /^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/;

export const recordNodeKey = (objectApiName: string, recordId: string) => `Record::${objectApiName}::${recordId}`;
export const recordTypeKey = (objectApiName: string) => `SalesforceRecord.${objectApiName}`;

// Inverse of recordNodeKey; null for any other key shape.
export function parseRecordNodeKey(nodeKey: string): { objectApiName: string; recordId: string } | null {
  if (!nodeKey.startsWith("Record::")) return null;
  const rest = nodeKey.slice("Record::".length);
  const i = rest.indexOf("::");
  return i < 0 ? null : { objectApiName: rest.slice(0, i), recordId: rest.slice(i + 2) };
}

// Escapes a user term for a SOQL LIKE literal: quote and backslash for the string, % and _ so they match literally.
export const likeLiteral = (term: string): string => `'%${term.trim().replace(/[\\'%_]/g, (c) => `\\${c}`)}%'`;

const nameFieldOf = (d: RecordDescribe): string | null => d.fields.find((f) => f.nameField)?.name ?? null;
const labelOf = (row: Record<string, unknown>, nameField: string): string => {
  const v = row[nameField];
  return v === null || v === undefined || v === "" ? "(no name)" : String(v);
};
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Validates the name against the org's own global describe before it ever reaches SOQL (port of
// OI_RecordSchemaUtil.describeAccessibleObject).
export async function describeAccessibleObject(api: RecordApi, objectApiName: string): Promise<RecordDescribe> {
  if (!API_NAME.test(objectApiName)) throw new RecordInputError("An object API name is required.");
  const global = (await api.describeGlobal()).find((o) => o.name.toLowerCase() === objectApiName.toLowerCase());
  if (!global) throw new RecordNotFoundError(`Unknown object: ${objectApiName}`);
  if (!global.queryable) throw new RecordInputError(`${global.name} cannot be queried.`);
  return api.describe(global.name);
}

// The Id must be well formed and its key prefix must belong to the object (port of
// OI_RecordSchemaUtil.validateRecordIdForObject), so a record Id never reaches SOQL unchecked.
export async function validateRecordIdForObject(api: RecordApi, describe: RecordDescribe, recordId: string): Promise<RecordGlobal[]> {
  if (!RECORD_ID.test(recordId)) throw new RecordInputError("The record Id is not valid.");
  const global = await api.describeGlobal();
  const owner = global.find((o) => o.keyPrefix === recordId.slice(0, 3));
  if (owner?.name !== describe.name) throw new RecordInputError(`The record Id does not belong to ${describe.name}.`);
  return global;
}

export class RecordService {
  constructor(private readonly api: RecordApi) {}

  private accessibleObject(objectApiName: string): Promise<RecordDescribe> {
    return describeAccessibleObject(this.api, objectApiName);
  }

  async search(objectApiName: string, term: string): Promise<RecordSummary[]> {
    const describe = await this.accessibleObject(objectApiName);
    if (term.trim().length < MIN_QUERY_LENGTH) return [];
    const nameField = nameFieldOf(describe);
    if (!nameField) return [];
    return this.summaries(describe, nameField, `WHERE ${nameField} LIKE ${likeLiteral(term)} `);
  }

  // Bounded alphabetical list shown the moment the picker gets focus, before anything is typed.
  async browse(objectApiName: string): Promise<RecordSummary[]> {
    const describe = await this.accessibleObject(objectApiName);
    const nameField = nameFieldOf(describe);
    return nameField ? this.summaries(describe, nameField, "") : [];
  }

  private async summaries(describe: RecordDescribe, nameField: string, where: string): Promise<RecordSummary[]> {
    const rows = await this.api.query(`SELECT Id, ${nameField} FROM ${describe.name} ${where}ORDER BY ${nameField} ASC LIMIT ${MAX_SEARCH_RESULTS}`);
    return rows.map((r) => ({ recordId: String(r.Id), label: labelOf(r, nameField), objectApiName: describe.name }));
  }

  async fragment(objectApiName: string, recordId: string): Promise<RecordFragment> {
    const describe = await this.accessibleObject(objectApiName);
    const global = await validateRecordIdForObject(this.api, describe, recordId);
    const prefixes = new Map(global.filter((o) => o.keyPrefix).map((o) => [o.keyPrefix as string, o]));

    const nameField = nameFieldOf(describe);
    const referenceFields = describe.fields.filter((f) => f.type === "reference");
    const wanted = new Set<string>(["Id", ...(nameField ? [nameField] : []), ...referenceFields.map((f) => f.name)]);
    for (const audit of ["CreatedDate", "LastModifiedDate"]) if (describe.fields.some((f) => f.name === audit)) wanted.add(audit);
    const centerRows = await this.api.query(`SELECT ${[...wanted].join(", ")} FROM ${describe.name} WHERE Id = '${recordId}' LIMIT 1`);
    const center = centerRows[0];
    if (!center) return { centerNodeKey: null, nodes: [], edges: [], hasMore: false, overview: null };

    const centerId = String(center.Id);
    const centerKey = recordNodeKey(describe.name, centerId);
    const nodes = new Map<string, RecordNode>();
    const edges: RecordEdge[] = [];
    const addNode = (objectApiName: string, id: string, label: string) => {
      const nodeKey = recordNodeKey(objectApiName, id);
      if (!nodes.has(nodeKey)) nodes.set(nodeKey, { nodeKey, typeKey: recordTypeKey(objectApiName), label, objectApiName, recordId: id });
      return nodeKey;
    };
    addNode(describe.name, centerId, nameField ? labelOf(center, nameField) : recordId);

    await this.addParents(referenceFields, center, centerKey, prefixes, addNode, edges);
    const hasMore = await this.addChildren(describe, centerId, centerKey, global, addNode, edges);

    const ownerEdge = edges.find((e) => e.typeKey === RECORD_PARENT_EDGE && e.viaField === "OwnerId");
    return {
      centerNodeKey: centerKey,
      nodes: [...nodes.values()],
      edges,
      hasMore,
      overview: { ownerName: ownerEdge ? (nodes.get(ownerEdge.target)?.label ?? null) : null, createdDate: text(center.CreatedDate), lastModifiedDate: text(center.LastModifiedDate) },
    };
  }

  // Parents are resolved from the Id value's own key prefix rather than the field's static referenceTo, so a
  // polymorphic lookup like OwnerId needs no special case. One query per distinct target object.
  private async addParents(
    referenceFields: RecordDescribeField[],
    center: Record<string, unknown>,
    centerKey: string,
    prefixes: Map<string, RecordGlobal>,
    addNode: (objectApiName: string, id: string, label: string) => string,
    edges: RecordEdge[]
  ) {
    const idsByObject = new Map<string, Set<string>>();
    const fieldsByTarget = new Map<string, Set<string>>();
    for (const field of referenceFields) {
      const value = center[field.name];
      if (typeof value !== "string" || !RECORD_ID.test(value)) continue;
      const target = prefixes.get(value.slice(0, 3));
      if (!target?.queryable) continue;
      if (!idsByObject.has(target.name)) idsByObject.set(target.name, new Set());
      idsByObject.get(target.name)!.add(value);
      fieldsByTarget.set(value, (fieldsByTarget.get(value) ?? new Set()).add(field.name));
    }
    await mapPool([...idsByObject.entries()], DESCRIBE_CONCURRENCY, async ([targetName, ids]) => {
      try {
        const targetDescribe = await this.api.describe(targetName);
        const targetNameField = nameFieldOf(targetDescribe);
        if (!targetNameField) return;
        const list = [...ids].map((id) => `'${id}'`).join(", ");
        const rows = await this.api.query(`SELECT Id, ${targetNameField} FROM ${targetName} WHERE Id IN (${list})`);
        for (const row of rows) {
          const id = String(row.Id);
          const key = addNode(targetName, id, labelOf(row, targetNameField));
          for (const fieldName of fieldsByTarget.get(id) ?? []) edges.push({ edgeKey: `${centerKey}::${fieldName}::${key}`, typeKey: RECORD_PARENT_EDGE, source: centerKey, target: key, viaField: fieldName });
        }
      } catch (err) {
        // A target that describes fine can still be unreadable in practice (feature-gated, no access): skip it, keep the rest.
        console.warn(`records: parent lookup for ${targetName} skipped:`, (err as Error).message);
      }
    });
  }

  // Two passes keep the API cost in check: a cheap batched Id-only subquery finds which relationships have rows,
  // and only those child objects are described and read with their names.
  private async addChildren(
    describe: RecordDescribe,
    recordId: string,
    centerKey: string,
    global: RecordGlobal[],
    addNode: (objectApiName: string, id: string, label: string) => string,
    edges: RecordEdge[]
  ): Promise<boolean> {
    const queryable = new Map(global.filter((o) => o.queryable).map((o) => [o.name, o]));
    const eligible = describe.childRelationships.filter((r) => r.relationshipName && queryable.has(r.childSObject));
    let hasMore = eligible.length > MAX_RELATIONSHIP_TYPES;
    const candidates = eligible.slice(0, MAX_RELATIONSHIP_TYPES);
    const fetchLimit = MAX_CHILDREN_PER_RELATIONSHIP + 1;

    const populated: RecordChildRelationship[] = [];
    for (let i = 0; i < candidates.length; i += CHILD_RELATIONSHIP_BATCH) {
      const batch = candidates.slice(i, i + CHILD_RELATIONSHIP_BATCH);
      const subqueries = batch.map((r) => `(SELECT Id FROM ${r.relationshipName} LIMIT 1)`).join(", ");
      try {
        const rows = await this.api.query(`SELECT Id, ${subqueries} FROM ${describe.name} WHERE Id = '${recordId}'`);
        const parent = rows[0];
        for (const r of batch) {
          const child = parent?.[r.relationshipName as string] as { records?: unknown[]; totalSize?: number } | null | undefined;
          if (child && ((child.records?.length ?? 0) > 0 || (child.totalSize ?? 0) > 0)) populated.push(r);
        }
      } catch (err) {
        // One relationship that is not queryable here would sink its whole batch; probe that batch one by one.
        console.warn("records: batched child probe failed, probing individually:", (err as Error).message);
        for (const r of batch) {
          try {
            if ((await this.api.query(`SELECT Id FROM ${r.childSObject} WHERE ${r.field} = '${recordId}' LIMIT 1`)).length > 0) populated.push(r);
          } catch {
            /* unreadable relationship: skipped */
          }
        }
      }
    }

    await mapPool(populated, DESCRIBE_CONCURRENCY, async (r) => {
      try {
        const childDescribe = await this.api.describe(r.childSObject);
        const childName = nameFieldOf(childDescribe);
        if (!childName) return;
        const rows = await this.api.query(`SELECT Id, ${childName} FROM ${r.childSObject} WHERE ${r.field} = '${recordId}' ORDER BY ${childName} ASC LIMIT ${fetchLimit}`);
        if (rows.length > MAX_CHILDREN_PER_RELATIONSHIP) hasMore = true;
        for (const row of rows.slice(0, MAX_CHILDREN_PER_RELATIONSHIP)) {
          const key = addNode(r.childSObject, String(row.Id), labelOf(row, childName));
          edges.push({ edgeKey: `${centerKey}::${r.field}::${key}`, typeKey: RECORD_CHILD_EDGE, source: centerKey, target: key, viaField: r.field });
        }
      } catch (err) {
        console.warn(`records: children of ${r.childSObject} skipped:`, (err as Error).message);
      }
    });
    return hasMore;
  }
}
