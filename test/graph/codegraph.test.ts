import assert from "node:assert/strict";
import test from "node:test";
import { CODEGRAPH_RECEIPT, graphCacheIdentity, refreshCodeGraph, seedCodeGraph, type GraphBaseline, type GraphDescriptor, type GraphSource } from "../../src/index.js";
const source: GraphSource = { worktreeRoot: "/product/wt", worktreeInstanceId: `git-worktree-v1:${"a".repeat(64)}`, headSha: "a".repeat(40), workingTreeFingerprint: `git-v1:${"1".repeat(64)}` };
const main: GraphSource = { ...source, worktreeRoot: "/product/main", worktreeInstanceId: `git-worktree-v1:${"b".repeat(64)}` };
const canonical = async (path: string) => path;
function baseline(): GraphBaseline { const descriptor: GraphDescriptor = { adapter: "codegraph", reviewedToolSource: CODEGRAPH_RECEIPT, cacheIdentity: graphCacheIdentity("codegraph", CODEGRAPH_RECEIPT, main), cacheRoot: "/product/main/.codegraph", worktreeRoot: main.worktreeRoot, worktreeInstanceId: main.worktreeInstanceId, indexedCommit: main.headSha, workingTreeFingerprint: main.workingTreeFingerprint, refreshedAt: "2026-08-04T00:00:00Z" }; return { source: main, descriptor, authoritativeRef: "refs/heads/main", resolvedSha: main.headSha, objectFormat: "sha1", clean: true }; }
test("CodeGraph requires actual FTS5 probe before exclusion or index", async () => {
  const calls: string[] = [];
  const result = await refreshCodeGraph(source, { enabled: true, localOnlyApproved: true, reviewedToolSource: CODEGRAPH_RECEIPT, nodeExecutablePath: "/tools/node", codegraphExecutablePath: "/tools/codegraph", command: { run: async (command) => { calls.push(command); return { code: 1 }; }, attest: async (_p, receipt) => ({ code: 0, stdout: receipt, stderr: "", timedOut: false }) }, files: { canonicalPath: canonical, addMachineLocalExclude: async () => assert.fail("must not exclude"), excluded: async () => false, tracked: async () => false, exists: async () => false } });
  assert.equal(result.decision.state, "unavailable"); assert.deepEqual(calls, ["/tools/node"]);
});
test("CodeGraph empirical seed uses FTS5, local exclusion and an exact baseline only", async () => {
  let excluded = false; let copied = false; const calls: string[] = [];
  const result = await seedCodeGraph(source, baseline(), { enabled: true, localOnlyApproved: true, reviewedToolSource: CODEGRAPH_RECEIPT, nodeExecutablePath: "/tools/node", codegraphExecutablePath: "/tools/codegraph", command: { run: async (command) => { calls.push(command); return { code: 0 }; }, attest: async (_p, receipt) => ({ code: 0, stdout: receipt, stderr: "", timedOut: false }) }, files: { canonicalPath: canonical, addMachineLocalExclude: async () => { excluded = true; }, excluded: async () => excluded, tracked: async () => false, exists: async () => copied, copy: async () => { copied = true; }, remove: async () => undefined } });
  assert.equal(result.decision.state, "fresh"); assert.deepEqual(calls, ["/tools/node"]);
});
test("CodeGraph telemetry/exclusion/tracked-cache checks precede local index", async () => {
  const calls: Array<{ command: string; env: Readonly<Record<string, string>> }> = []; let excluded = false;
  const result = await refreshCodeGraph(source, { enabled: true, localOnlyApproved: true, reviewedToolSource: CODEGRAPH_RECEIPT, nodeExecutablePath: "/tools/node", codegraphExecutablePath: "/tools/codegraph", command: { run: async (command, _args, options) => { calls.push({ command, env: options.env }); return { code: 0 }; }, attest: async (_p, receipt) => ({ code: 0, stdout: receipt, stderr: "", timedOut: false }) }, files: { canonicalPath: canonical, addMachineLocalExclude: async () => { excluded = true; }, excluded: async () => excluded, tracked: async () => false, exists: async () => true } });
  assert.equal(result.decision.state, "fresh"); assert.deepEqual(calls.map((call) => call.command), ["/tools/node", "/tools/codegraph"]); assert.equal(calls[1]?.env.CODEGRAPH_TELEMETRY, "0");
});
test("CodeGraph rejects non-main/moved baselines and symlink or pre-existing cache roots", async () => {
  for (const candidate of [{ ...baseline(), authoritativeRef: "refs/heads/topic" as "refs/heads/main" }, { ...baseline(), resolvedSha: "b".repeat(40) }, { ...baseline(), source }]) {
    const result = await seedCodeGraph(source, candidate, { enabled: true, localOnlyApproved: true, reviewedToolSource: CODEGRAPH_RECEIPT, nodeExecutablePath: "/tools/node", command: { run: async () => ({ code: 0 }), attest: async (_p, receipt) => ({ code: 0, stdout: receipt, stderr: "", timedOut: false }) }, files: { canonicalPath: canonical, addMachineLocalExclude: async () => assert.fail("must not exclude"), excluded: async () => false, tracked: async () => false, exists: async () => false, copy: async () => assert.fail("must not copy"), remove: async () => undefined } });
    assert.equal(result.decision.authoritative, false);
  }
  const alias = await refreshCodeGraph(source, { enabled: true, localOnlyApproved: true, reviewedToolSource: CODEGRAPH_RECEIPT, nodeExecutablePath: "/tools/node", codegraphExecutablePath: "/tools/codegraph", command: { run: async () => ({ code: 0 }), attest: async (_p, receipt) => ({ code: 0, stdout: receipt, stderr: "", timedOut: false }) }, files: { canonicalPath: async (path) => path.endsWith(".codegraph") ? "/elsewhere/.codegraph" : path, addMachineLocalExclude: async () => assert.fail("must not initialize"), excluded: async () => false, tracked: async () => false, exists: async () => false } });
  assert.equal(alias.decision.state, "invalid");
});
