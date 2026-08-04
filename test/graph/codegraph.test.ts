import assert from "node:assert/strict";
import test from "node:test";
import { graphFingerprint, type GraphSource } from "../../src/index.js";
import { CODEGRAPH_RECEIPT, refreshCodeGraph } from "../../src/graph/codegraph.js";
const source: GraphSource = { worktreeRoot: "/product/wt", worktreeInstanceId: `git-worktree-v1:${"a".repeat(64)}`, headSha: "a".repeat(40), workingTreeFingerprint: graphFingerprint("") };
const reader = { canonicalWorktree: async () => source.worktreeRoot, worktreeInstanceId: async () => source.worktreeInstanceId, headSha: async () => source.headSha, worktreeStatus: async () => "" };
const lock = { acquire: async () => ({ lock: { ownerHost: "local", ownerPid: 1, acquiredAt: "2026-08-04T00:00:00Z" } }), release: async () => undefined };
const artifact = "9".repeat(64), nodeArtifact = "8".repeat(64), content = "c".repeat(64);
const files = { canonicalPath: async (p: string) => p, addMachineLocalExclude: async () => undefined, excluded: async () => true, tracked: async () => false, exists: async () => true, contentDigest: async () => content };
const observed = (path: string) => ({ executable: path, version: path.endsWith("node") ? "24.13.1" : "1.5.0", sourceReceipt: path.endsWith("node") ? "node:sqlite-fts5" : CODEGRAPH_RECEIPT, artifactSha256: path.endsWith("node") ? nodeArtifact : artifact });
test("CodeGraph uses non-echo executable observations and a bounded actual FTS5 probe", async () => {
  const calls: string[] = [];
  const result = await refreshCodeGraph(source, { enabled: true, localOnlyApproved: true, reviewedToolSource: CODEGRAPH_RECEIPT, artifactSha256: artifact, nodeArtifactSha256: nodeArtifact, nodeExecutablePath: "/tools/node", codegraphExecutablePath: "/tools/codegraph", lock, sourceReader: reader, command: { observe: async (path) => observed(path), run: async (path) => { calls.push(path); return { code: path.endsWith("node") ? 1 : 0, stdout: "", stderr: "", timedOut: false }; } }, files });
  assert.equal(result.decision.state, "unavailable"); assert.deepEqual(calls, ["/tools/node"]);
});
test("CodeGraph keeps one lock through FTS5, exclusion, index, source reread and descriptor", async () => {
  const trace: string[] = []; const result = await refreshCodeGraph(source, { enabled: true, localOnlyApproved: true, reviewedToolSource: CODEGRAPH_RECEIPT, artifactSha256: artifact, nodeArtifactSha256: nodeArtifact, nodeExecutablePath: "/tools/node", codegraphExecutablePath: "/tools/codegraph", lock: { acquire: async () => { trace.push("acquire"); return { lock: { ownerHost: "x", ownerPid: 1, acquiredAt: "2026-01-01T00:00:00Z" } }; }, release: async () => { trace.push("release"); } }, sourceReader: { ...reader, worktreeStatus: async () => { trace.push("reread"); return ""; } }, command: { observe: async p => { trace.push(`observe:${p}`); return observed(p); }, run: async p => { trace.push(`run:${p}`); return { code: 0, stdout: "", stderr: "", timedOut: false }; } }, files: { ...files, addMachineLocalExclude: async () => { trace.push("exclude"); }, contentDigest: async () => { trace.push("digest"); return content; } } });
  assert.equal(result.decision.state, "fresh"); assert.deepEqual(trace, ["acquire", "observe:/tools/node", "observe:/tools/codegraph", "run:/tools/node", "exclude", "run:/tools/codegraph", "digest", "reread", "release"]);
});

test("CodeGraph re-verifies exclusion after indexing before descriptor publication", async () => {
  let checks = 0; const result = await refreshCodeGraph(source, { enabled: true, localOnlyApproved: true, reviewedToolSource: CODEGRAPH_RECEIPT, artifactSha256: artifact, nodeArtifactSha256: nodeArtifact, nodeExecutablePath: "/tools/node", codegraphExecutablePath: "/tools/codegraph", lock, sourceReader: reader, command: { observe: async (path) => observed(path), run: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }) }, files: { ...files, excluded: async () => ++checks === 1 } });
  assert.equal(result.decision.state, "failed"); assert.equal(result.descriptor, undefined); assert.equal(checks, 2);
});

test("CodeGraph lock record is outside the product worktree", async () => {
  let path = ""; await refreshCodeGraph(source, { enabled: true, localOnlyApproved: true, reviewedToolSource: CODEGRAPH_RECEIPT, artifactSha256: artifact, nodeArtifactSha256: nodeArtifact, nodeExecutablePath: "/tools/node", codegraphExecutablePath: "/tools/codegraph", sourceReader: reader, command: { observe: async (value) => observed(value), run: async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }) }, files, lock: { acquire: async value => { path = value; return { lock: { ownerHost: "x", ownerPid: 1, acquiredAt: "2026-01-01T00:00:00Z" } }; }, release: async () => undefined } });
  assert.match(path, /^\/product\/\.shipyard-graph-state\/graph-locks\//); assert.doesNotMatch(path, /^\/product\/wt\//);
});
