import assert from "node:assert/strict";
import test from "node:test";
import { graphCacheIdentity, graphDecision, refreshGraph, type GraphAdapter, type GraphDescriptor, type GraphSource, type GraphSourceReader } from "../../src/index.js";

const source: GraphSource = { worktreeRoot: "/feature", worktreeInstanceId: `git-worktree-v1:${"a".repeat(64)}`, headSha: "a".repeat(40), workingTreeFingerprint: `git-v1:${"1".repeat(64)}` };
function descriptor(): GraphDescriptor { return { adapter: "graphify", reviewedToolSource: "graphify@0.9.32#00efd6e7969837ae4a9f11d8d504dcd3b20b09df", cacheIdentity: graphCacheIdentity("graphify", "graphify@0.9.32#00efd6e7969837ae4a9f11d8d504dcd3b20b09df", source), cacheRoot: "/cache", worktreeRoot: source.worktreeRoot, worktreeInstanceId: source.worktreeInstanceId, indexedCommit: source.headSha, workingTreeFingerprint: source.workingTreeFingerprint, refreshedAt: "2026-08-04T00:00:00.000Z" }; }
function reader(statuses: string[]): GraphSourceReader { return { canonicalWorktree: async () => source.worktreeRoot, worktreeInstanceId: async () => source.worktreeInstanceId, headSha: async () => source.headSha, worktreeStatus: async () => statuses.shift() ?? "" }; }
function adapter(refresh: () => Promise<GraphDescriptor>): GraphAdapter { return { name: "graphify", probe: async () => ({ available: true }), refresh, status: async () => graphDecision("fresh", "verified") }; }

test("refresh never publishes a descriptor when source drifts, adapter fails, or status declines authority", async () => {
  const drift = await refreshGraph(adapter(async () => descriptor()), reader(["", "changed"]), source.worktreeRoot);
  assert.equal(drift.decision.state, "stale"); assert.equal(drift.descriptor, undefined);
  const failed = await refreshGraph(adapter(async () => { throw new Error("failed tool"); }), reader(["", ""]), source.worktreeRoot);
  assert.equal(failed.decision.state, "failed"); assert.equal(failed.descriptor, undefined);
  const nonAuthoritative: GraphAdapter = { ...adapter(async () => descriptor()), status: async () => graphDecision("failed", "missing output") };
  const missing = await refreshGraph(nonAuthoritative, reader(["", ""]), source.worktreeRoot);
  assert.equal(missing.decision.authoritative, false); assert.equal(missing.descriptor, undefined);
});
