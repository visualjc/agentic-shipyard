import assert from "node:assert/strict";
import test from "node:test";
import { dependencyStatus } from "../../src/commands/dependency-status.js";

test("dependency-status is a narrow read-only command seam", async () => {
  const calls: unknown[] = [];
  const result = await dependencyStatus({ async inspect(input) { calls.push(input); return { schemaVersion: 1 as const, findings: [], ready: false, nextSafeAction: "shipyard-setup" }; } }, { host: "codex", lane: "bug" });
  assert.deepEqual(calls, [{ host: "codex", lane: "bug" }]);
  assert.equal(result.nextSafeAction, "shipyard-setup");
});
