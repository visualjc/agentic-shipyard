import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIFY_RECEIPT, graphFingerprint, refreshGraphify, type GraphSource } from "../../src/index.js";
const source: GraphSource = { worktreeRoot: "/product/wt", worktreeInstanceId: `git-worktree-v1:${"a".repeat(64)}`, headSha: "a".repeat(40), workingTreeFingerprint: graphFingerprint("") };
const reader = { canonicalWorktree: async () => source.worktreeRoot, worktreeInstanceId: async () => source.worktreeInstanceId, headSha: async () => source.headSha, worktreeStatus: async () => "" };
const lock = { acquire: async () => ({ lock: { ownerHost: "local", ownerPid: 1, acquiredAt: "2026-08-04T00:00:00Z" } }), release: async () => undefined };
const receipt = { executable: "/tools/graphify", version: "0.9.32", sourceReceipt: GRAPHIFY_RECEIPT };
const command = { observe: async () => receipt, run: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }) };
test("Graphify is disabled before observing, locking, or writing", async () => {
  let calls = 0; const result = await refreshGraphify(source, { enabled: false, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/cache/wt", executablePath: "/tools/graphify", lock, sourceReader: reader, command: { ...command, observe: async () => { calls++; return receipt; } }, files: { canonicalPath: async p => p, exists: async () => true, productGraphifyLeak: async () => false } });
  assert.equal(result.decision.state, "disabled"); assert.equal(calls, 0);
});
test("Graphify holds one lock through command, audit, source reread and descriptor", async () => {
  const trace: string[] = []; const result = await refreshGraphify(source, { enabled: true, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/cache/wt", executablePath: "/tools/graphify", lock: { acquire: async () => { trace.push("acquire"); return { lock: { ownerHost: "x", ownerPid: 1, acquiredAt: "2026-01-01T00:00:00Z" } }; }, release: async () => { trace.push("release"); } }, sourceReader: { ...reader, worktreeStatus: async () => { trace.push("reread"); return ""; } }, command: { ...command, observe: async () => { trace.push("observe"); return receipt; }, run: async () => { trace.push("run"); return { code: 0, stdout: "", stderr: "", timedOut: false }; } }, files: { canonicalPath: async p => p, exists: async () => { trace.push("exists"); return true; }, productGraphifyLeak: async () => { trace.push("audit"); return false; } } });
  assert.equal(result.decision.state, "fresh"); assert.deepEqual(trace, ["acquire", "observe", "run", "audit", "exists", "reread", "release"]);
});
test("Graphify rejects echo-style/malformed observation, missing lock, release failure, and source drift", async () => {
  const base = { enabled: true, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/cache/wt", executablePath: "/tools/graphify", sourceReader: reader, command, files: { canonicalPath: async (p: string) => p, exists: async () => true, productGraphifyLeak: async () => false } };
  assert.equal((await refreshGraphify(source, base)).decision.state, "invalid");
  assert.equal((await refreshGraphify(source, { ...base, lock, command: { ...command, observe: async () => ({ executable: "/tools/graphify", version: "0.9", sourceReceipt: "wrong" }) } })).decision.state, "unavailable");
  assert.equal((await refreshGraphify(source, { ...base, lock: { ...lock, release: async () => { throw new Error("private"); } } })).decision.state, "failed");
  assert.equal((await refreshGraphify(source, { ...base, lock, sourceReader: { ...reader, worktreeStatus: async () => "changed" } })).decision.state, "stale");
});
