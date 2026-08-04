import assert from "node:assert/strict";
import test from "node:test";
import { CODEGRAPH_RECEIPT, graphFingerprint, refreshCodeGraph, type GraphSource } from "../../src/index.js";
const source: GraphSource = { worktreeRoot: "/product/wt", worktreeInstanceId: `git-worktree-v1:${"a".repeat(64)}`, headSha: "a".repeat(40), workingTreeFingerprint: graphFingerprint("") };
const reader = { canonicalWorktree: async () => source.worktreeRoot, worktreeInstanceId: async () => source.worktreeInstanceId, headSha: async () => source.headSha, worktreeStatus: async () => "" };
const lock = { acquire: async () => ({ lock: { ownerHost: "local", ownerPid: 1, acquiredAt: "2026-08-04T00:00:00Z" } }), release: async () => undefined };
const files = { canonicalPath: async (p: string) => p, addMachineLocalExclude: async () => undefined, excluded: async () => true, tracked: async () => false, exists: async () => true };
const observed = (path: string) => ({ executable: path, version: path.endsWith("node") ? "24.13.1" : "1.5.0", sourceReceipt: path.endsWith("node") ? "node:sqlite-fts5" : CODEGRAPH_RECEIPT });
test("CodeGraph uses non-echo executable observations and a bounded actual FTS5 probe", async () => {
  const calls: string[] = [];
  const result = await refreshCodeGraph(source, { enabled: true, localOnlyApproved: true, reviewedToolSource: CODEGRAPH_RECEIPT, nodeExecutablePath: "/tools/node", codegraphExecutablePath: "/tools/codegraph", lock, sourceReader: reader, command: { observe: async (path) => observed(path), run: async (path) => { calls.push(path); return { code: path.endsWith("node") ? 1 : 0, stdout: "", stderr: "", timedOut: false }; } }, files });
  assert.equal(result.decision.state, "unavailable"); assert.deepEqual(calls, ["/tools/node"]);
});
test("CodeGraph keeps one lock through FTS5, exclusion, index, source reread and descriptor", async () => {
  const trace: string[] = []; const result = await refreshCodeGraph(source, { enabled: true, localOnlyApproved: true, reviewedToolSource: CODEGRAPH_RECEIPT, nodeExecutablePath: "/tools/node", codegraphExecutablePath: "/tools/codegraph", lock: { acquire: async () => { trace.push("acquire"); return { lock: { ownerHost: "x", ownerPid: 1, acquiredAt: "2026-01-01T00:00:00Z" } }; }, release: async () => { trace.push("release"); } }, sourceReader: { ...reader, worktreeStatus: async () => { trace.push("reread"); return ""; } }, command: { observe: async p => { trace.push(`observe:${p}`); return observed(p); }, run: async p => { trace.push(`run:${p}`); return { code: 0, stdout: "", stderr: "", timedOut: false }; } }, files: { ...files, addMachineLocalExclude: async () => { trace.push("exclude"); } } });
  assert.equal(result.decision.state, "fresh"); assert.deepEqual(trace, ["acquire", "observe:/tools/node", "observe:/tools/codegraph", "run:/tools/node", "exclude", "run:/tools/codegraph", "reread", "release"]);
});
