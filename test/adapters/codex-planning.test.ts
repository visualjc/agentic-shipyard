import assert from "node:assert/strict";
import test from "node:test";
import { runCodexPlanning } from "../../src/adapters/codex-planning.js";
import { assertMattEnvelope } from "../../src/adapters/matt-skills.js";

test("Codex planning adapter accepts typed steps only and returns an opaque checkpoint", async () => {
  const seen: unknown[] = [];
  const result = await runCodexPlanning({ matt: { async plan(input) { seen.push(input); return { resumeCheckpoint: "matt-1", artifacts: [{ step: "wayfinder" as const, path: "planning/p1/artifacts/wayfinder.md", sha256: "b".repeat(64) }] }; } }, ccpm: { async synthesize(input) { seen.push(input); return { resumeCheckpoint: "ccpm-1", acceptanceAuthority: false as const, artifacts: [{ step: "ccpm-prd" as const, path: "planning/p1/artifacts/prd.md", sha256: "c".repeat(64) }, { step: "ccpm-vertical-tasks" as const, path: "planning/p1/artifacts/tasks.md", sha256: "d".repeat(64) }] }; } } }, { role: "planner", recordId: "p1", repositoryPath: "/repo", productSha: "a".repeat(40), objectFormat: "sha1", lane: "large", steps: ["wayfinder"], requestText: "feature" }, { role: "planner", recordId: "p1", repositoryPath: "/repo", productSha: "a".repeat(40), objectFormat: "sha1", steps: ["ccpm-prd", "ccpm-vertical-tasks"], requestText: "feature", acceptanceAuthority: false });
  assert.equal(result.providerId, "codex"); assert.equal(result.artifacts.length, 3);
  assert.equal(seen.length, 2);
  assert.equal(JSON.stringify(seen).includes("token"), false);
  assert.equal(JSON.stringify(seen).includes("shell"), false);
});

test("Codex planning rejects oversized or unsafe adapter checkpoint", async () => {
  await assert.rejects(() => runCodexPlanning({ matt: { async plan() { return { resumeCheckpoint: "bad checkpoint", artifacts: [] }; } }, ccpm: { async synthesize() { return { resumeCheckpoint: "never", artifacts: [], acceptanceAuthority: false as const }; } } }, { role: "planner", recordId: "p1", repositoryPath: "/repo", productSha: "a".repeat(40), objectFormat: "sha1", lane: "small", steps: ["to-spec"], requestText: "fix" }));
});

test("Codex planning rejects nested accessor, proxy, and sparse artifacts before consuming them", async () => {
  let getterCalled = false;
  const envelope = { role: "planner" as const, recordId: "p1", repositoryPath: "/repo", productSha: "a".repeat(40), objectFormat: "sha1" as const, lane: "small" as const, steps: ["to-spec"] as const, requestText: "fix" };
  const hostile = { resumeCheckpoint: "ok", artifacts: [{ step: "to-spec", path: "planning/p1/artifacts/a.md", sha256: "b".repeat(64) }] }; Object.defineProperty(hostile.artifacts[0]!, "path", { enumerable: true, get() { getterCalled = true; throw new Error("secret"); } });
  await assert.rejects(() => runCodexPlanning({ matt: { async plan() { return hostile as any; } }, ccpm: { async synthesize() { throw new Error("unreachable"); } } }, envelope), /Codex planning document is invalid/);
  assert.equal(getterCalled, false);
  await assert.rejects(() => runCodexPlanning({ matt: { async plan() { return new Proxy({}, { ownKeys() { throw new Error("secret"); } }) as any; } }, ccpm: { async synthesize() { throw new Error("unreachable"); } } }, envelope), /Codex planning document is invalid/);
  const sparse: unknown[] = []; sparse.length = 1;
  await assert.rejects(() => runCodexPlanning({ matt: { async plan() { return { resumeCheckpoint: "ok", artifacts: sparse } as any; } }, ccpm: { async synthesize() { throw new Error("unreachable"); } } }, envelope), /Codex planning document is invalid/);
});

test("planner envelopes require the exact object-format SHA length", () => {
  const source = { role: "planner", recordId: "p1", repositoryPath: "/repo", productSha: "a".repeat(40), objectFormat: "sha1", lane: "small", steps: ["to-spec"], requestText: "fix" };
  assert.doesNotThrow(() => assertMattEnvelope(source));
  for (const length of [39, 41, 63, 65]) assert.throws(() => assertMattEnvelope({ ...source, productSha: "a".repeat(length) }));
  assert.doesNotThrow(() => assertMattEnvelope({ ...source, objectFormat: "sha256", productSha: "a".repeat(64) }));
});
