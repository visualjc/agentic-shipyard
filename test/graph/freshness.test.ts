import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGraphFreshness, evaluateGraphLock, GraphLockService, graphCacheIdentity, graphDecision, validateGraphDescriptor, GRAPHIFY_RECEIPT, type GraphDescriptor, type GraphSource } from "../../src/index.js";
import { FakeProcess } from "../helpers/fakes.js";

const source: GraphSource = { worktreeRoot: "/private/a", worktreeInstanceId: `git-worktree-v1:${"a".repeat(64)}`, headSha: "a".repeat(40), workingTreeFingerprint: `git-v1:${"1".repeat(64)}` };
function descriptor(overrides: Partial<GraphDescriptor> = {}): GraphDescriptor { return { adapter: "graphify", reviewedToolSource: GRAPHIFY_RECEIPT, artifactSha256: "9".repeat(64), contentSha256: "c".repeat(64), cacheIdentity: graphCacheIdentity("graphify", GRAPHIFY_RECEIPT, source), cacheRoot: "/cache/a", worktreeRoot: source.worktreeRoot, worktreeInstanceId: source.worktreeInstanceId, indexedCommit: source.headSha, workingTreeFingerprint: source.workingTreeFingerprint, refreshedAt: "2026-08-04T00:00:00Z", ...overrides }; }

test("exact commit and dirty fingerprint are both required and divergent worktrees do not share cache identity", () => {
  assert.equal(validateGraphDescriptor(source, descriptor(), "graphify", GRAPHIFY_RECEIPT).state, "fresh");
  assert.equal(validateGraphDescriptor({ ...source, headSha: "b".repeat(40) }, descriptor(), "graphify", GRAPHIFY_RECEIPT).state, "stale");
  assert.equal(validateGraphDescriptor({ ...source, workingTreeFingerprint: `git-v1:${"2".repeat(64)}` }, descriptor(), "graphify", GRAPHIFY_RECEIPT).state, "stale");
  assert.notEqual(graphCacheIdentity("graphify", GRAPHIFY_RECEIPT, source), graphCacheIdentity("graphify", GRAPHIFY_RECEIPT, { ...source, worktreeRoot: "/private/sibling" }));
});

test("restart/recreation descriptor mismatch and unavailable runtime always select source fallback", async () => {
  assert.equal((await evaluateGraphFreshness({ source, descriptor: descriptor({ worktreeRoot: "/private/recreated" }), adapter: "graphify", reviewedToolSource: GRAPHIFY_RECEIPT })).authoritative, false);
  const unavailable = await evaluateGraphFreshness({ source, adapter: "graphify", reviewedToolSource: GRAPHIFY_RECEIPT, runtime: { available: false, reason: "missing" } });
  assert.deepEqual(unavailable, graphDecision("unavailable", "Experimental graph runtime is unavailable."));
});

test("a private cache may retain its exact immutable-main seed identity but not a sibling worktree identity", () => {
  const seeded = descriptor({ seededFromSha: "c".repeat(40), cacheIdentity: graphCacheIdentity("graphify", GRAPHIFY_RECEIPT, source, "c".repeat(40)) });
  assert.equal(validateGraphDescriptor(source, seeded, "graphify", GRAPHIFY_RECEIPT).state, "fresh");
  assert.equal(validateGraphDescriptor({ ...source, worktreeRoot: "/private/sibling" }, seeded, "graphify", GRAPHIFY_RECEIPT).state, "invalid");
});
test("same-path worktree recreation changes instance proof and rejects an old clean cache", () => {
  const recreated = { ...source, worktreeInstanceId: `git-worktree-v1:${"b".repeat(64)}` };
  assert.equal(validateGraphDescriptor(recreated, descriptor(), "graphify", GRAPHIFY_RECEIPT).state, "invalid");
  assert.notEqual(graphCacheIdentity("graphify", GRAPHIFY_RECEIPT, recreated), graphCacheIdentity("graphify", GRAPHIFY_RECEIPT, source));
});

test("locks distinguish live, stale and unknown/cross-host ownership without removal", async () => {
  const process = new FakeProcess(); process.alive.add(44);
  assert.equal((await evaluateGraphLock({ ownerHost: "test-host", ownerPid: 44, acquiredAt: "2026-08-03T00:00:00Z" }, process))?.state, "blocked");
  assert.equal((await evaluateGraphLock({ ownerHost: "test-host", ownerPid: 55, acquiredAt: "2026-08-03T00:00:00Z" }, process))?.state, "stale");
  assert.equal((await evaluateGraphLock({ ownerHost: "other", ownerPid: 55, acquiredAt: "2026-08-03T00:00:00Z" }, process))?.state, "blocked");
});
test("cross-host locks never probe the local process table", async () => {
  let probes = 0;
  const process = {
    hostName: () => "test-host",
    processId: () => 1,
    now: () => new Date("2026-08-04T00:00:00Z"),
    isProcessAlive: async () => { probes++; throw new Error("must not probe"); },
  };
  assert.equal((await evaluateGraphLock({ ownerHost: "other", ownerPid: 55, acquiredAt: "2026-08-03T00:00:00Z" }, process))?.state, "blocked");
  assert.equal(probes, 0);
});
test("injected lock store uses exclusive acquire and never auto-removes stale records", async () => {
  const process = new FakeProcess(); let removed = 0; let existing: import("../../src/index.js").GraphCacheLock | undefined;
  const service = new GraphLockService({ read: async () => existing, createExclusive: async (_p, lock) => { if (existing) return false; existing = lock; return true; }, removeVerified: async () => { removed++; return false; } }, process);
  const first = await service.acquire("/cache/one.lock"); assert.ok(first.lock);
  const second = await service.acquire("/cache/one.lock"); assert.equal(second.decision?.state, "blocked"); assert.equal(removed, 0);
});
test("lock service blocks malformed, cross-host, dead-new and acquire-race records without recovery writes", async () => {
  const process = new FakeProcess(); let creates = 0; let removes = 0;
  for (const existing of [
    { ownerHost: "other", ownerPid: 9, acquiredAt: "2026-08-03T00:00:00.000Z" },
    { ownerHost: "test-host", ownerPid: 9, acquiredAt: "2026-08-03T23:59:59.000Z" },
    { ownerHost: "", ownerPid: 0, acquiredAt: "bad" },
  ]) {
    const service = new GraphLockService({ read: async () => existing as import("../../src/index.js").GraphCacheLock, createExclusive: async () => { creates++; return true; }, removeVerified: async () => { removes++; return true; } }, process);
    assert.equal((await service.acquire("/cache/lock")).decision?.state, "blocked");
  }
  const race = new GraphLockService({ read: async () => undefined, createExclusive: async () => { creates++; return false; }, removeVerified: async () => { removes++; return true; } }, process);
  assert.equal((await race.acquire("/cache/lock")).decision?.state, "blocked"); assert.equal(creates, 1); assert.equal(removes, 0);
});
test("manual verified stale-lock recovery alone may remove a stale local lock", async () => {
  const process = new FakeProcess(); const stale = { ownerHost: "test-host", ownerPid: 88, acquiredAt: "2026-08-03T00:00:00.000Z" }; let removed = 0;
  const service = new GraphLockService({ read: async () => stale, createExclusive: async () => false, removeVerified: async () => { removed++; return true; } }, process);
  const recovered = await service.recoverVerifiedStale("/machine/.shipyard-graph-state/graph-locks/a.lock");
  assert.equal(recovered.state, "stale"); assert.equal(removed, 1);
  const failedRelease = new GraphLockService({ read: async () => undefined, createExclusive: async () => true, removeVerified: async () => false }, process);
  const acquired = await failedRelease.acquire("/machine/lock"); await assert.rejects(() => failedRelease.release("/machine/lock", acquired.lock!), /release could not be verified/);
});
