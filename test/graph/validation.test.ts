import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIFY_RECEIPT, isGraphSha, validateGraphSource } from "../../src/index.js";

test("accepts exact SHA-1/SHA-256 only and rejects in-between lengths", () => {
  assert.equal(isGraphSha("a".repeat(40)), true); assert.equal(isGraphSha("b".repeat(64)), true);
  for (const size of [0, 39, 41, 63, 65]) assert.equal(isGraphSha("a".repeat(size)), false);
});
test("hostile graph values fail closed without calling getters or leaking thrown text", () => {
  let called = false;
  const hostile = Object.create(Object.prototype, { worktreeRoot: { enumerable: true, get() { called = true; throw new Error("secret-message"); } } });
  assert.throws(() => validateGraphSource(hostile), /Invalid source graph value/); assert.equal(called, false);
  const cyclic: Record<string, unknown> = { worktreeRoot: "/w", headSha: "a".repeat(40), workingTreeFingerprint: `git-v1:${"a".repeat(64)}` }; cyclic.self = cyclic;
  assert.throws(() => validateGraphSource(cyclic), /Invalid source graph value/);
  assert.equal(GRAPHIFY_RECEIPT.includes("graphify@"), true);
});
