import assert from "node:assert/strict";
import test from "node:test";
import { GRAPHIFY_RECEIPT, graphCacheIdentity, refreshGraphify, seedGraphify, type GraphBaseline, type GraphDescriptor, type GraphSource } from "../../src/index.js";

const source: GraphSource = { worktreeRoot: "/product/wt", worktreeInstanceId: `git-worktree-v1:${"a".repeat(64)}`, headSha: "a".repeat(40), workingTreeFingerprint: `git-v1:${"1".repeat(64)}` };
const main: GraphSource = { ...source, worktreeRoot: "/product/main", worktreeInstanceId: `git-worktree-v1:${"b".repeat(64)}` };
const canonical = async (path: string) => path;
function baseline(): GraphBaseline { const descriptor: GraphDescriptor = { adapter: "graphify", reviewedToolSource: GRAPHIFY_RECEIPT, cacheIdentity: graphCacheIdentity("graphify", GRAPHIFY_RECEIPT, main), cacheRoot: "/cache/main", worktreeRoot: main.worktreeRoot, worktreeInstanceId: main.worktreeInstanceId, indexedCommit: main.headSha, workingTreeFingerprint: main.workingTreeFingerprint, refreshedAt: "2026-08-04T00:00:00Z" }; return { source: main, descriptor, authoritativeRef: "refs/heads/main", resolvedSha: main.headSha, objectFormat: "sha1", clean: true }; }
test("Graphify is disabled by default without process or cache access", async () => {
  let calls = 0;
  const result = await refreshGraphify(source, { enabled: false, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/cache/wt", executablePath: "/tools/graphify", command: { run: async () => { calls++; return { code: 0 }; }, attest: async () => ({ code: 0, stdout: GRAPHIFY_RECEIPT, stderr: "", timedOut: false }) }, files: { canonicalPath: canonical, exists: async () => true, productGraphifyLeak: async () => false } });
  assert.equal(result.decision.state, "disabled"); assert.equal(calls, 0);
});
test("Graphify copies only an exact authoritative baseline into a private per-worktree cache", async () => {
  const copied: string[] = [];
  let copiedDone = false;
  const seeded = await seedGraphify(source, baseline(), { enabled: true, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/cache/feature", executablePath: "/tools/graphify", command: { run: async () => ({ code: 0 }), attest: async () => ({ code: 0, stdout: GRAPHIFY_RECEIPT, stderr: "", timedOut: false }) }, files: { canonicalPath: canonical, exists: async (path) => path === "/cache/feature" ? false : copiedDone, productGraphifyLeak: async () => false, copy: async (from, to) => { copiedDone = true; copied.push(`${from}:${to}`); }, remove: async () => undefined } });
  assert.equal(seeded.decision.state, "fresh"); assert.deepEqual(copied, ["/cache/main/graphify-out:/cache/feature/graphify-out"]);
});
test("Graphify enforces matching private output, local-only flags and relocation audit", async () => {
  let request: { args: readonly string[]; env: Readonly<Record<string, string>> } | undefined;
  const result = await refreshGraphify(source, { enabled: true, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/cache/wt", executablePath: "/tools/graphify", command: { run: async (_c, args, o) => { request = { args, env: o.env }; return { code: 0 }; }, attest: async () => ({ code: 0, stdout: GRAPHIFY_RECEIPT, stderr: "", timedOut: false }) }, files: { canonicalPath: canonical, exists: async () => true, productGraphifyLeak: async () => false } });
  assert.equal(result.decision.state, "fresh"); assert.deepEqual(request?.args, ["index", "--code-only", "--out", "/cache/wt/graphify-out"]); assert.equal(request?.env.GRAPHIFY_OUT, "/cache/wt/graphify-out"); assert.equal(request?.env.GRAPHIFY_QUERY_LOG_DISABLE, "1");
  const leaked = await refreshGraphify(source, { enabled: true, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/cache/wt", executablePath: "/tools/graphify", command: { run: async () => ({ code: 0 }), attest: async () => ({ code: 0, stdout: GRAPHIFY_RECEIPT, stderr: "", timedOut: false }) }, files: { canonicalPath: canonical, exists: async () => true, productGraphifyLeak: async () => true } });
  assert.equal(leaked.decision.state, "failed");
});
test("Graphify rejects labelled/non-main, moved, dirty, shared, alias and partial seed baselines", async () => {
  const invalids: GraphBaseline[] = [
    { ...baseline(), authoritativeRef: "refs/heads/feature" as "refs/heads/main" },
    { ...baseline(), resolvedSha: "b".repeat(40) },
    { ...baseline(), clean: false as true },
    { ...baseline(), source: source },
  ];
  for (const candidate of invalids) {
    const result = await seedGraphify(source, candidate, { enabled: true, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/cache/new", executablePath: "/tools/graphify", command: { run: async () => ({ code: 0 }), attest: async () => ({ code: 0, stdout: GRAPHIFY_RECEIPT, stderr: "", timedOut: false }) }, files: { canonicalPath: canonical, exists: async () => false, productGraphifyLeak: async () => false, copy: async () => assert.fail("must not copy"), remove: async () => undefined } });
    assert.equal(result.decision.authoritative, false);
  }
  let removed = 0;
  const partial = await seedGraphify(source, baseline(), { enabled: true, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/cache/new", executablePath: "/tools/graphify", command: { run: async () => ({ code: 0 }), attest: async () => ({ code: 0, stdout: GRAPHIFY_RECEIPT, stderr: "", timedOut: false }) }, files: { canonicalPath: async (path) => path === "/cache/new" ? "/product/wt/alias" : path, exists: async () => false, productGraphifyLeak: async () => false, copy: async () => assert.fail("must not copy"), remove: async () => { removed++; } } });
  assert.equal(partial.decision.state, "invalid"); assert.equal(removed, 0);
  let cleanup = 0;
  const failed = await seedGraphify(source, baseline(), { enabled: true, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/cache/new", executablePath: "/tools/graphify", command: { run: async () => ({ code: 0 }), attest: async () => ({ code: 0, stdout: GRAPHIFY_RECEIPT, stderr: "", timedOut: false }) }, files: { canonicalPath: canonical, exists: async (path) => path !== "/cache/new", productGraphifyLeak: async () => false, copy: async () => { throw new Error("partial"); }, remove: async () => { cleanup++; } } });
  assert.equal(failed.decision.state, "failed"); assert.equal(cleanup, 1); assert.equal(failed.descriptor, undefined);
});
