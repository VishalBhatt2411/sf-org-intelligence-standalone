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

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

// A node key is the sha-256 hex of its identity (see keys.ts).
export const NODE_KEY_PATTERN = /^[0-9a-f]{64}$/;
