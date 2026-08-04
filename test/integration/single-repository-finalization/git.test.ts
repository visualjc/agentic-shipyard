import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { NodeSingleRepositoryFinalizationGitAuthority } from "../../../src/adapters/single-repository-finalization-git.js";
import { NodeSyncGit } from "../../../src/adapters/sync-git.js";

const execute = promisify(execFile);
async function git(repository: string, ...args: string[]): Promise<string> { return (await execute("git", ["-C", repository, ...args], { encoding: "utf8" })).stdout.trim(); }

test("one-repository Git adapter observes external squash merge, tags exact head, syncs local main, and deletes only the leased branch", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-single-final-git-")), remote = join(root, "remote.git"), product = join(root, "product"), team = join(root, "team");
  try {
    await execute("git", ["init", "--bare", "--initial-branch=main", remote]); await execute("git", ["clone", remote, product]);
    await git(product, "config", "user.name", "Product"); await git(product, "config", "user.email", "product@example.test"); await writeFile(join(product, "app.txt"), "base\n"); await git(product, "add", "."); await git(product, "commit", "-m", "base"); await git(product, "push", "origin", "main"); const base = await git(product, "rev-parse", "main");
    await git(product, "switch", "-c", "shipyard/delivery"); await writeFile(join(product, "app.txt"), "reviewed\n"); await git(product, "commit", "-am", "delivery"); const head = await git(product, "rev-parse", "HEAD"), tree = await git(product, "rev-parse", "HEAD^{tree}"); await git(product, "push", "origin", "shipyard/delivery"); await git(product, "switch", "main");
    await execute("git", ["clone", remote, team]); await git(team, "config", "user.name", "Team"); await git(team, "config", "user.email", "team@example.test"); await git(team, "merge", "--squash", "origin/shipyard/delivery"); await git(team, "commit", "-m", "human squash merge"); const merge = await git(team, "rev-parse", "HEAD"); assert.equal(await git(team, "rev-parse", "HEAD^{tree}"), tree); await git(team, "push", "origin", "main");
    const repository = { owner: "local", name: "product", remote: { name: "origin", url: "https://github.com/local/product.git" }, defaultBranch: "main" }, runner = { run: async ({ executable, argv, env }: { executable: string; argv: readonly string[]; env: Readonly<Record<string, string>> }) => { const rewritten = { ...env, GIT_CONFIG_COUNT: "4", GIT_CONFIG_KEY_3: `url.file://${remote}.insteadOf`, GIT_CONFIG_VALUE_3: "https://github.com/local/product.git" }; try { const result = await execute(executable, [...argv], { encoding: "utf8", env: { ...process.env, ...rewritten } }); return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }; } catch (error) { const value = error as { code?: number; stdout?: string; stderr?: string }; return { exitCode: value.code ?? 1, stdout: value.stdout ?? "", stderr: value.stderr ?? "" }; } } }, authority = new NodeSingleRepositoryFinalizationGitAuthority({ resolve: async () => ({ token: "fixture-token", verifiedActorLogin: "actor" }) }, new NodeSyncGit("/usr/bin/git"), runner, "/usr/bin/git"), request = { repositoryPath: product, actorLogin: "actor", repository, deliveryBranch: "shipyard/delivery", expectedMergeSha: merge, expectedFinalHeadSha: head };
    const session = await authority.open(request); assert.equal(session.observation.destinationMainSha, merge); assert.equal(session.observation.developmentMainSha, base); assert.equal(session.observation.developmentBranchSha, head); assert.equal(session.observation.mergeCommitTreeSha, tree); assert.equal(session.observation.mergeCommitAncestorOfMain, true);
    const tagObject = await session.ensureReviewedTag("shipyard/reviewed/delivery", head, "Reviewed delivery"); assert.match(tagObject, /^[a-f0-9]{40}$/); await session.synchronizeLocalMain(base, merge); assert.equal(await git(product, "rev-parse", "main"), merge); await session.deleteDeliveryBranch("shipyard/delivery", head); assert.equal(await git(remote, "rev-parse", "--verify", "refs/heads/shipyard/delivery").catch(() => "missing"), "missing"); await session.release();
    const resumed = await authority.open(request); assert.equal(resumed.observation.developmentBranchSha, undefined); assert.equal(await resumed.ensureReviewedTag("shipyard/reviewed/delivery", head, "Reviewed delivery"), tagObject); await resumed.synchronizeLocalMain(base, merge); await resumed.deleteDeliveryBranch("shipyard/delivery", head); await resumed.release();
    await git(product, "push", "origin", `${merge}:refs/heads/shipyard-ledger`);
    const observed = await authority.observeFinalizationStatus({ repositoryPath: product, actorLogin: "actor", repository, deliveryBranch: "shipyard/delivery", mergeCommitSha: merge });
    assert.equal(observed.ledgerSha, merge); assert.equal(observed.deliveryBranchSha, undefined); assert.equal(observed.mainSha, merge); assert.equal(observed.mergeReachableFromMain, true);
    assert.equal(await git(remote, "rev-parse", "refs/heads/main"), merge); assert.equal(await git(remote, "rev-parse", "refs/tags/shipyard/reviewed/delivery^{}"), head);
  } finally { await rm(root, { recursive: true, force: true }); }
});
