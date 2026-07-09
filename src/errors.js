// Typed error hierarchy for the simulated agent pipeline.
//
// The split exists so a caller can decide how to react to a failure without
// inspecting error messages: TransientError means "try again, the world will
// probably be fine in a moment", FatalError means "stop, something is
// structurally wrong and retrying will not help".

export class TransientError extends Error {
  constructor(message, { agent, cause } = {}) {
    super(message);
    this.name = "TransientError";
    this.agent = agent;
    this.cause = cause;
    this.retryable = true;
  }
}

export class FatalError extends Error {
  constructor(message, { agent, cause } = {}) {
    super(message);
    this.name = "FatalError";
    this.agent = agent;
    this.cause = cause;
    this.retryable = false;
  }
}

export class CircuitOpenError extends Error {
  constructor(message, { agent } = {}) {
    super(message);
    this.name = "CircuitOpenError";
    this.agent = agent;
    this.retryable = false;
  }
}
