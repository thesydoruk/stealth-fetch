import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionDeadline, FetchCancelledError } from "./session-deadline";

describe("createSessionDeadline", () => {
  it("caps a wait to the remaining budget", () => {
    const deadline = createSessionDeadline(5_000);
    assert.equal(deadline.capTimeoutMs(90_000) <= 5_000, true);
    assert.equal(deadline.capTimeoutMs(10) <= 10, true);
  });

  it("throws deadline after the clock expires", async () => {
    const deadline = createSessionDeadline(20);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.throws(() => deadline.throwIfCancelled(), FetchCancelledError);
  });

  it("throws aborted when the signal fires", () => {
    const abort = new AbortController();
    const deadline = createSessionDeadline(60_000, abort.signal);
    abort.abort();
    assert.throws(() => deadline.throwIfCancelled(), (err: unknown) => {
      return err instanceof FetchCancelledError && err.reason === "aborted";
    });
  });
});
