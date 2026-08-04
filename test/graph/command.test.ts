import assert from "node:assert/strict";
import test from "node:test";
import { canonicalExecutable, commandFailure, GRAPH_COMMAND_MAX_BYTES, snapshotGraphCommandResult } from "../../src/index.js";
test("bounded command receipts reject accessors, timeout, nonzero, malformed and oversize data with fixed diagnostics", () => {
  assert.equal(canonicalExecutable("graphify"), undefined); assert.equal(canonicalExecutable("/tools/graphify"), "/tools/graphify");
  assert.equal(commandFailure({ code: 0, stdout: "", stderr: "", timedOut: true }), "Experimental graph command failed safely.");
  assert.equal(commandFailure({ code: 1, stdout: "private", stderr: "private", timedOut: false }), "Experimental graph command returned non-zero.");
  assert.equal(commandFailure({ code: 0, stdout: "x".repeat(GRAPH_COMMAND_MAX_BYTES + 1), stderr: "", timedOut: false }), "Experimental graph command failed safely.");
  const hostile = Object.create(Object.prototype, { code: { enumerable: true, get() { throw new Error("secret"); } } }); assert.equal(snapshotGraphCommandResult(hostile), undefined);
});
