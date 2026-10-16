// Errors the graph read services throw for caller mistakes. The routes turn them into 400 and 404;
// anything else is a real failure and falls through to the global 500 handler.

export class GraphInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphInputError";
  }
}

export class GraphNotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "GraphNotFoundError";
  }
}

export const SALESFORCE_SESSION_MESSAGE = "The Salesforce session for this org has expired. Disconnect and connect the org again to read live data.";

// jsforce reports a dead OAuth session as "Unable to refresh session due to: expired access/refresh token", an
// `invalid_grant` OAuth error or INVALID_SESSION_ID. Only a reconnect fixes it, so the routes say so plainly
// instead of answering a bare 500.
export function isSalesforceSessionError(error: unknown): boolean {
  const e = error as { name?: unknown; errorCode?: unknown; message?: unknown } | null;
  if (e?.errorCode === "INVALID_SESSION_ID" || e?.name === "invalid_grant") return true;
  return typeof e?.message === "string" && /expired access\/refresh token|unable to refresh session|invalid_grant|INVALID_SESSION_ID/i.test(e.message);
}

export const clamp =(value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

// A node key is the sha-256 hex of its identity (see keys.ts).
export const NODE_KEY_PATTERN = /^[0-9a-f]{64}$/;
