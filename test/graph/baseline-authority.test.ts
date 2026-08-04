import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorizeGitGraphBaseline, createGitGraphSourceReader, graphCacheIdentity, snapshotGraphSource, type GraphBaseline, type GraphDescriptor } from "../../src/index.js";
import { consumeGraphSeedAuthorization } from "../../src/graph/baseline.js";
import { seedCodeGraph } from "../../src/graph/codegraph.js";
import { GRAPHIFY_RECEIPT, seedGraphify } from "../../src/graph/graphify.js";

test("only live Git authority can seal a distinct clean main baseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-baseline-")); const feature = `${root}-feature`; const git = (...args: string[]) => execFileSync("/usr/bin/git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  try {
    git("init", "-b", "main"); git("config", "user.email", "fixture@example.test"); git("config", "user.name", "Fixture"); await writeFile(join(root, "a"), "a\n"); git("add", "a"); git("commit", "-m", "base"); git("worktree", "add", "-b", "feature", feature);
    const reader = createGitGraphSourceReader("/usr/bin/git"); const main = await snapshotGraphSource(reader, root); const source = await snapshotGraphSource(reader, feature);
    const descriptor: GraphDescriptor = { adapter: "graphify", reviewedToolSource: GRAPHIFY_RECEIPT, cacheIdentity: graphCacheIdentity("graphify", GRAPHIFY_RECEIPT, main), cacheRoot: join(root, "..", "main-cache"), worktreeRoot: main.worktreeRoot, worktreeInstanceId: main.worktreeInstanceId, indexedCommit: main.headSha, workingTreeFingerprint: main.workingTreeFingerprint, refreshedAt: "2026-08-04T00:00:00.000Z" };
    const authorized = await authorizeGitGraphBaseline({ mainWorktree: root, featureWorktree: feature, descriptor, adapter: "graphify", reviewedToolSource: GRAPHIFY_RECEIPT }, "/usr/bin/git");
    assert.equal(authorized.decision.state, "fresh", authorized.decision.reason); assert.ok(authorized.authorization);
    assert.ok(consumeGraphSeedAuthorization(authorized.authorization));
    assert.equal(consumeGraphSeedAuthorization(authorized.authorization), undefined, "authorization must be one-shot");
    const adapterBound = await authorizeGitGraphBaseline({ mainWorktree: root, featureWorktree: feature, descriptor, adapter: "graphify", reviewedToolSource: GRAPHIFY_RECEIPT }, "/usr/bin/git");
    assert.equal((await seedCodeGraph(source, adapterBound.authorization!, {} as never)).decision.state, "invalid", "authorization must not cross adapters");
    let touched = false;
    const forged: GraphBaseline = { source: main, descriptor, authoritativeRef: "refs/heads/main", resolvedSha: main.headSha, objectFormat: "sha1", clean: true };
    const rejected = await seedGraphify(source, forged as never, { enabled: true, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, cacheRoot: "/tmp/forged", executablePath: "/bin/false", command: { observe: async () => { touched = true; }, run: async () => ({}) }, files: { canonicalPath: async p => p, exists: async () => false, productGraphifyLeak: async () => false } });
    assert.equal(rejected.decision.state, "invalid"); assert.equal(touched, false);
  } finally { await rm(feature, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); }
});
