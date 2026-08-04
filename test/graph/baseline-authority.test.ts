import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorizeGitGraphBaseline, createGitGraphSourceReader, createGraphLaneService, snapshotGraphSource, type GraphBaseline, type Profile } from "../../src/index.js";
import { graphDescriptorPath } from "../../src/adapters/graph-runtime.js";
import { consumeGraphSeedAuthorization } from "../../src/graph/baseline.js";
import { seedCodeGraph } from "../../src/graph/codegraph.js";
import { GRAPHIFY_RECEIPT, seedGraphify } from "../../src/graph/graphify.js";

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const topology = { kind: "single-repository" as const, repository: { owner: "test", name: "repo", remote: { name: "origin", url: "https://example.test/repo.git" }, defaultBranch: "main" } };

test("only live Git plus the exact Shipyard-owned descriptor, cache, and artifact can seal a main baseline", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "shipyard-baseline-")); const mainWorktree = join(temporary, "main"), featureWorktree = join(temporary, "feature"), home = join(temporary, "home"), cacheRoot = join(temporary, "cache"), executablePath = join(temporary, "graphify");
  const git = (cwd: string, ...args: string[]) => execFileSync("/usr/bin/git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  try {
    execFileSync("/usr/bin/git", ["init", "-b", "main", mainWorktree]); git(mainWorktree, "config", "user.email", "fixture@example.test"); git(mainWorktree, "config", "user.name", "Fixture"); await writeFile(join(mainWorktree, "a"), "a\n"); git(mainWorktree, "add", "a"); git(mainWorktree, "commit", "-m", "base"); await mkdir(cacheRoot);
    const body = "#!/bin/sh\nif [ \"$1\" = --version ]; then printf '0.9.32\\n'; exit 0; fi\nmkdir -p \"$GRAPHIFY_OUT\"\nprintf graph > \"$GRAPHIFY_OUT/index\"\n", artifactSha256 = sha256(body); await writeFile(executablePath, body); await chmod(executablePath, 0o755);
    const profile: Profile = { schemaVersion: 1, name: "p", actor: { login: "actor" }, topology, allowedOperations: ["status"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }] }, graph: { enabled: true, localOnlyApproved: true, adapter: "graphify", reviewedToolSource: GRAPHIFY_RECEIPT, artifactSha256, executablePath: await realpath(executablePath), cacheRoot: await realpath(cacheRoot) } };
    const service = createGraphLaneService(home, "/usr/bin/git"); const refreshed = await service.refresh(profile, mainWorktree); assert.equal(refreshed.decision.state, "fresh", refreshed.decision.reason); assert.ok(refreshed.descriptor);
    git(mainWorktree, "worktree", "add", "-b", "feature", featureWorktree);
    const request = { home, profile, mainWorktree, featureWorktree };
    const authorized = await authorizeGitGraphBaseline(request, "/usr/bin/git"); assert.equal(authorized.decision.state, "fresh", authorized.decision.reason); assert.ok(authorized.authorization);
    assert.ok(consumeGraphSeedAuthorization(authorized.authorization)); assert.equal(consumeGraphSeedAuthorization(authorized.authorization), undefined, "authorization must be one-shot");
    const feature = await snapshotGraphSource(createGitGraphSourceReader("/usr/bin/git"), featureWorktree);
    const adapterBound = await authorizeGitGraphBaseline(request, "/usr/bin/git"); assert.equal(adapterBound.decision.state, "fresh", adapterBound.decision.reason); assert.equal((await seedCodeGraph(feature, adapterBound.authorization!, {} as never)).decision.state, "invalid", "authorization must not cross adapters");

    const arbitraryCache = join(temporary, "attacker-cache"); await mkdir(join(arbitraryCache, "graphify-out"), { recursive: true }); await writeFile(join(arbitraryCache, "graphify-out", "index"), "attacker\n");
    const callerSupplied = await authorizeGitGraphBaseline({ ...request, descriptor: { ...refreshed.descriptor, cacheRoot: arbitraryCache }, cacheRoot: arbitraryCache } as never, "/usr/bin/git"); assert.notEqual(callerSupplied.decision.state, "fresh"); assert.equal(callerSupplied.authorization, undefined, "caller-supplied descriptor/cache fields must be rejected at the boundary");

    const main = await snapshotGraphSource(createGitGraphSourceReader("/usr/bin/git"), mainWorktree); const descriptorFile = graphDescriptorPath(home, "graphify", main.worktreeInstanceId); const originalDescriptorText = await readFile(descriptorFile, "utf8"); const stored = JSON.parse(originalDescriptorText) as Record<string, unknown>;
    await writeFile(descriptorFile, `${JSON.stringify({ ...stored, cacheRoot: arbitraryCache, contentSha256: sha256("attacker-self-attestation") })}\n`);
    const diverted = await authorizeGitGraphBaseline(request, "/usr/bin/git"); assert.notEqual(diverted.decision.state, "fresh"); assert.equal(diverted.authorization, undefined, "a durable descriptor cannot redirect authority to an arbitrary cache");
    await writeFile(descriptorFile, originalDescriptorText);
    const beforeCacheMutation = await authorizeGitGraphBaseline(request, "/usr/bin/git"); assert.equal(beforeCacheMutation.decision.state, "fresh", beforeCacheMutation.decision.reason); assert.ok(beforeCacheMutation.authorization);
    await writeFile(join(refreshed.descriptor.cacheRoot, "graphify-out", "index"), "tampered\n");
    const staleSeed = await service.seed(profile, featureWorktree, beforeCacheMutation.authorization!); assert.equal(staleSeed.decision.state, "invalid", "a cache mutation after authorization must not be copied into a seed"); assert.equal(staleSeed.descriptor, undefined);
    const staleContent = await authorizeGitGraphBaseline(request, "/usr/bin/git"); assert.notEqual(staleContent.decision.state, "fresh"); assert.equal(staleContent.authorization, undefined, "cache bytes must match the content digest sealed during refresh");

    let touched = false; const forged: GraphBaseline = { source: main, descriptor: refreshed.descriptor, authoritativeRef: "refs/heads/main", resolvedSha: main.headSha, objectFormat: "sha1", clean: true };
    const rejected = await seedGraphify(feature, forged as never, { enabled: true, localOnlyApproved: true, reviewedToolSource: GRAPHIFY_RECEIPT, artifactSha256, cacheRoot: "/tmp/forged", executablePath: "/bin/false", command: { observe: async () => { touched = true; }, run: async () => ({}) }, files: { canonicalPath: async path => path, exists: async () => false, observeProductTree: async () => ({}), auditProductTree: async () => ({ state: "clean" }), contentDigest: async () => sha256("") } });
    assert.equal(rejected.decision.state, "invalid"); assert.equal(touched, false, "structural baseline lookalikes must never reach graph ports");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
