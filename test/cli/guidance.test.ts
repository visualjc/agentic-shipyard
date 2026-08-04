import assert from "node:assert/strict";
import test from "node:test";
import { commandGuidance } from "../../src/cli/guidance.js";
import { MutationLockError } from "../../src/locking/mutation-lock.js";

test("mutation-lock guidance names the command being retried", () => {
  const error = new MutationLockError("lock-held", "held");
  const setup = commandGuidance(error, "setup");
  assert.match(setup, /shipyard-status/); assert.match(setup, /shipyard-setup/); assert.doesNotMatch(setup, /shipyard-sync/);
  const sync = commandGuidance(error, "sync");
  assert.match(sync, /shipyard-status/); assert.match(sync, /shipyard-sync/); assert.doesNotMatch(sync, /shipyard-setup/);
});
