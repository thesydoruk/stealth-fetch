import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPoolWaitQueue } from "./pool-wait-queue";
import { FetchCancelledError } from "./session-deadline";

describe("createPoolWaitQueue", () => {
  it("wakes the oldest waiter", async () => {
    const queue = createPoolWaitQueue();
    const first = queue.wait({ timeoutMs: 1_000 });
    const second = queue.wait({ timeoutMs: 1_000 });
    assert.equal(queue.pending, 2);
    queue.notifyNext();
    await first;
    assert.equal(queue.pending, 1);
    queue.notifyNext();
    await second;
    assert.equal(queue.pending, 0);
  });

  it("does not steal a later slot after abort", async () => {
    const queue = createPoolWaitQueue();
    const abort = new AbortController();
    const stale = queue.wait({ timeoutMs: 1_000, signal: abort.signal });
    abort.abort();
    await assert.rejects(stale, FetchCancelledError);
    assert.equal(queue.pending, 0);

    const live = queue.wait({ timeoutMs: 1_000 });
    queue.notifyNext();
    await live;
  });

  it("times out a waiter without leaving it in the queue", async () => {
    const queue = createPoolWaitQueue();
    const pending = queue.wait({ timeoutMs: 20 });
    await assert.rejects(pending, (err: unknown) => {
      return err instanceof FetchCancelledError && err.reason === "deadline";
    });
    assert.equal(queue.pending, 0);
    queue.notifyNext();
  });
});
