// Distinguishes "the AI agent/toolkit failed" from "the database failed" so
// callers (HTTP/WS transport) can map each to an appropriate status code and
// message instead of a single generic failure.

export class AgentError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "AgentError";
  }
}

export class RepositoryError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RepositoryError";
  }
}

// The requested todo doesn't exist, or doesn't belong to the requesting
// user — deliberately doesn't distinguish the two, so a client can't probe
// for other users' todo ids.
export class NotFoundError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "NotFoundError";
  }
}
