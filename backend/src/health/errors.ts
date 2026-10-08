// Errors the health services throw for caller mistakes. The routes turn them into 400 and 404;
// anything else is a real failure and falls through to the global 500 handler.

export class HealthInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HealthInputError";
  }
}

export class HealthNotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "HealthNotFoundError";
  }
}
