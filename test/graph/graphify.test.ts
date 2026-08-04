import assert from "node:assert/strict";
import test from "node:test";
import { graphFingerprint, type GraphSource } from "../../src/index.js";
import { GRAPHIFY_RECEIPT, refreshGraphify } from "../../src/graph/graphify.js";
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
  assert.equal((await refreshGraphify(source, { ...base, lock, sourceReader: { ...reader, worktreeInstanceId: async () => `git-worktree-v1:${"b".repeat(64)}` } })).decision.state, "stale");
});

test("Graphify redacts throwing canonicalization, acquire, file, and command ports", async () => {
  const common = { enabled: true, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/cache/wt", executablePath: "/tools/graphify", sourceReader: reader, command, files: { canonicalPath: async (p: string) => p, exists: async () => true, productGraphifyLeak: async () => false }, lock };
  const cases = [
    { ...common, files: { ...common.files, canonicalPath: async () => { throw new Error("canonical-secret"); } } },
    { ...common, lock: { ...lock, acquire: async () => { throw new Error("acquire-secret"); } } },
    { ...common, lock: { ...lock, acquire: async () => ({ decision: { state: "blocked", authoritative: false, fallbackAction: "inspect-source-directly", reason: "decision-secret", extra: true } } as never) } },
    { ...common, files: { ...common.files, productGraphifyLeak: async () => { throw new Error("file-secret"); } } },
    { ...common, command: { ...command, run: async () => { throw new Error("command-secret"); } } },
  ];
  for (const options of cases) { const result = await refreshGraphify(source, options); assert.equal(result.decision.authoritative, false); assert.doesNotMatch(result.decision.reason, /secret/); }
});

test("release failure rolls back a descriptor staged while the transaction lock was held", async () => {
  const trace: string[] = []; const result = await refreshGraphify(source, { enabled: true, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/cache/wt", executablePath: "/tools/graphify", sourceReader: reader, command, files: { canonicalPath: async p => p, exists: async () => true, productGraphifyLeak: async () => false }, lock: { acquire: async () => { trace.push("acquire"); return { lock: { ownerHost: "x", ownerPid: 1, acquiredAt: "2026-01-01T00:00:00Z" } }; }, release: async () => { trace.push("release"); throw new Error("release-private"); } }, descriptorPublisher: { write: async () => { trace.push("descriptor-write"); }, remove: async () => { trace.push("descriptor-remove"); } } });
  assert.equal(result.decision.state, "failed"); assert.deepEqual(trace, ["acquire", "descriptor-write", "release", "descriptor-remove"]); assert.equal(result.descriptor, undefined);
});

test("a blocked lock acquisition never removes another transaction's descriptor", async () => {
  let removed = 0;
  const result = await refreshGraphify(source, { enabled: true, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/cache/wt", executablePath: "/tools/graphify", sourceReader: reader, command, files: { canonicalPath: async p => p, exists: async () => true, productGraphifyLeak: async () => false }, lock: { acquire: async () => ({ decision: { state: "blocked", authoritative: false, fallbackAction: "inspect-source-directly", reason: "held" } }), release: async () => { throw new Error("must not release"); } }, descriptorPublisher: { write: async () => { throw new Error("must not write"); }, remove: async () => { removed++; } } });
  assert.equal(result.decision.state, "blocked"); assert.equal(removed, 0);
});

test("Graphify lock record stays in the sibling external state root", async () => {
  let path = ""; await refreshGraphify(source, { enabled: true, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/cache/wt", executablePath: "/tools/graphify", sourceReader: reader, command, files: { canonicalPath: async p => p, exists: async () => true, productGraphifyLeak: async () => false }, lock: { acquire: async value => { path = value; return { lock: { ownerHost: "x", ownerPid: 1, acquiredAt: "2026-01-01T00:00:00Z" } }; }, release: async () => undefined } });
  assert.match(path, /^\/cache\/\.shipyard-graph-state\/graph-locks\//); assert.doesNotMatch(path, /^\/cache\/wt\//);
});

test("one physical worktree cache keeps the same operation lock across commits", async () => {
  const paths: string[] = []; const next: GraphSource = { ...source, headSha: "b".repeat(40), workingTreeFingerprint: graphFingerprint("changed") };
  for (const current of [source, next]) {
    const currentReader = { canonicalWorktree: async () => current.worktreeRoot, worktreeInstanceId: async () => current.worktreeInstanceId, headSha: async () => current.headSha, worktreeStatus: async () => current === source ? "" : "changed" };
    const result = await refreshGraphify(current, { enabled: true, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/cache/wt", executablePath: "/tools/graphify", sourceReader: currentReader, command, files: { canonicalPath: async p => p, exists: async () => true, productGraphifyLeak: async () => false }, lock: { acquire: async path => { paths.push(path); return { lock: { ownerHost: "x", ownerPid: 1, acquiredAt: "2026-01-01T00:00:00Z" } }; }, release: async () => undefined } });
    assert.equal(result.decision.state, "fresh");
  }
  assert.equal(paths.length, 2); assert.equal(paths[0], paths[1]);
});
