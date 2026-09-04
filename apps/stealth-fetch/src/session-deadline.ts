/**
 * Wall-clock budget for one stealth fetch (warmup, target, solvers, retries).
 */

export class FetchCancelledError extends Error {
  readonly reason: "deadline" | "aborted";

  constructor(reason: "deadline" | "aborted") {
    super(reason === "aborted" ? "Stealth fetch aborted" : "Stealth fetch deadline exceeded");
    this.name = "FetchCancelledError";
    this.reason = reason;
  }
}

/** Remaining session time plus cancel checks. */
export interface SessionDeadline {
  remainingMs(): number;
  throwIfCancelled(): void;
  /** Cap a Playwright/CDP wait by what is left on the session clock. */
  capTimeoutMs(requestedMs: number): number;
  readonly signal?: AbortSignal;
}

/** `timeoutMs` covers the whole session, not each navigation. */
export function createSessionDeadline(timeoutMs: number, signal?: AbortSignal): SessionDeadline {
  const deadlineAt = Date.now() + Math.max(1, timeoutMs);

  function remainingMs(): number {
    return Math.max(0, deadlineAt - Date.now());
  }

  function throwIfCancelled(): void {
    if (signal?.aborted) throw new FetchCancelledError("aborted");
    if (Date.now() >= deadlineAt) throw new FetchCancelledError("deadline");
  }

  function capTimeoutMs(requestedMs: number): number {
    throwIfCancelled();
    return Math.max(1, Math.min(requestedMs, remainingMs()));
  }

  return { remainingMs, throwIfCancelled, capTimeoutMs, signal };
}
