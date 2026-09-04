/**
 * Cancellable FIFO waiters for a full browser pool.
 * Timed-out or aborted waiters are removed so they cannot steal a later slot.
 */

import { FetchCancelledError } from "./session-deadline";

type Waiter = () => void;

/** FIFO waiters that drop out on timeout or abort so they cannot take a later slot. */
export function createPoolWaitQueue() {
  const waiters = new Set<Waiter>();

  function notifyNext(): void {
    const next = waiters.values().next().value as Waiter | undefined;
    if (!next) return;
    waiters.delete(next);
    next();
  }

  function wait(options: { timeoutMs: number; signal?: AbortSignal }): Promise<void> {
    const timeoutMs = Math.max(1, options.timeoutMs);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        waiters.delete(onRelease);
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        fn();
      };
      const onRelease = (): void => finish(() => resolve());
      const onAbort = (): void => finish(() => reject(new FetchCancelledError("aborted")));
      const timer = setTimeout(() => {
        finish(() => reject(new FetchCancelledError("deadline")));
      }, timeoutMs);

      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      waiters.add(onRelease);
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  return { wait, notifyNext, get pending() {
    return waiters.size;
  } };
}
