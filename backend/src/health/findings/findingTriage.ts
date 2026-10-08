import { HealthInputError, HealthNotFoundError } from "../errors";
import { isFindingStatus, type FindingStatus } from "../types";
import type { FindingRepository, NewFindingEvent, StoredFinding } from "./findingTypes";

// Triage: the people-owned fields of a finding. Every change is validated, applied only if it differs
// from what is stored, and recorded as an audit event.

const TEXT_LIMITS = { owner: 120, notes: 4000, compensatingControl: 2000, falsePositiveReason: 2000 } as const;
const TEXT_FIELDS = Object.keys(TEXT_LIMITS) as Array<keyof typeof TEXT_LIMITS>;
const DATE_FIELDS = ["dueDate", "riskAcceptanceExpiry"] as const;
const ALLOWED = new Set<string>(["status", ...TEXT_FIELDS, ...DATE_FIELDS]);

type Patch = {
  status?: FindingStatus;
  owner?: string | null;
  notes?: string | null;
  compensatingControl?: string | null;
  falsePositiveReason?: string | null;
  dueDate?: Date | null;
  riskAcceptanceExpiry?: Date | null;
};

function parseText(field: keyof typeof TEXT_LIMITS, value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new HealthInputError(`${field} must be text or null`);
  const trimmed = value.trim();
  if (trimmed.length > TEXT_LIMITS[field]) throw new HealthInputError(`${field} must be at most ${TEXT_LIMITS[field]} characters`);
  return trimmed === "" ? null : trimmed;
}

function parseDate(field: string, value: unknown): Date | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(value)) throw new HealthInputError(`${field} must be a date (YYYY-MM-DD) or null`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HealthInputError(`${field} is not a valid date`);
  return date;
}

export function parseTriage(input: unknown): Patch {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HealthInputError("Body must be an object");
  const body = input as Record<string, unknown>;
  const unknown = Object.keys(body).filter((k) => !ALLOWED.has(k));
  if (unknown.length > 0) throw new HealthInputError(`Cannot change: ${unknown.join(", ")}`);
  const patch: Patch = {};
  if ("status" in body) {
    if (!isFindingStatus(body.status)) throw new HealthInputError("status is not valid");
    patch.status = body.status;
  }
  for (const f of TEXT_FIELDS) if (f in body) patch[f] = parseText(f, body[f]);
  for (const f of DATE_FIELDS) if (f in body) patch[f] = parseDate(f, body[f]);
  return patch;
}

const same = (a: unknown, b: unknown) => (a instanceof Date || b instanceof Date ? (a as Date | null)?.getTime() === (b as Date | null)?.getTime() : a === b);
const show = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

export async function applyTriage(repo: FindingRepository, connectionId: string, id: string, input: unknown, actor: string, now: Date): Promise<StoredFinding> {
  const patch = parseTriage(input);
  const current = await repo.get(connectionId, id);
  if (!current) throw new HealthNotFoundError("Finding not found");

  const next = { ...current, ...patch };
  if (next.status === "false_positive" && !next.falsePositiveReason) throw new HealthInputError("falsePositiveReason is required to mark a finding as a false positive");
  if (patch.riskAcceptanceExpiry && patch.riskAcceptanceExpiry.getTime() <= now.getTime()) throw new HealthInputError("riskAcceptanceExpiry must be in the future");

  const changes = (Object.keys(patch) as Array<keyof Patch>).filter((k) => !same(patch[k], current[k]));
  if (changes.length === 0) return current;

  const update: Record<string, unknown> = {};
  for (const k of changes) update[k] = patch[k];
  // resolvedAt follows the status: stamped when resolved by hand, cleared when taken out of resolved.
  if (patch.status && patch.status !== current.status) {
    if (patch.status === "resolved") update.resolvedAt = now;
    else if (current.status === "resolved") update.resolvedAt = null;
  }

  const saved = await repo.update(connectionId, id, update);
  if (!saved) throw new HealthNotFoundError("Finding not found");
  const events: NewFindingEvent[] = changes.map((k) => ({ findingId: id, field: k, oldValue: show(current[k]), newValue: show(patch[k]), changedBy: actor, changedAt: now }));
  await repo.addEvents(events);
  return saved;
}
