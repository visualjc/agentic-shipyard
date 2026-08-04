import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { NodeSyncGit } from "../../../src/adapters/sync-git.js";
import { SyncService } from "../../../src/sync/service.js";
import { MutationLockService } from "../../../src/locking/mutation-lock.js";
import { FakeProcess, MemoryFilesystem } from "../../helpers/fakes.js";
import type { Profile } from "../../../src/contracts/types.js";
import { profileFingerprint } from "../../../src/profile/fingerprint.js";

const run = promisify(execFile); const git = "/usr/bin/git";
async function command(path: string, args: string[]) { return (await run(git, ["-C", path, ...args], { encoding: "utf8" })).stdout.trim(); }
async function fixture(format = "sha1") {
  const root = await mkdtemp(join(tmpdir(), "shipyard-sync-")); const remote = join(root, "destination.git"); const repo = join(root, "development");
  await run(git, ["init", `--object-format=${format}`, "--bare", remote], { encoding: "utf8" }); await run(git, ["clone", remote, repo], { encoding: "utf8" });
  await command(repo, ["config", "user.email", "test@example.test"]); await command(repo, ["config", "user.name", "Test"]); await writeFile(join(repo, "app.ts"), "one\n"); await command(repo, ["add", "."]); await command(repo, ["commit", "-m", "initial"]); await command(repo, ["branch", "-M", "main"]); await command(repo, ["push", "origin", "main"]); await command(repo, ["remote", "rename", "origin", "upstream"]); await command(repo, ["remote", "add", "origin", remote]);
  await writeFile(join(repo, "app.ts"), "two\n"); await command(repo, ["commit", "-am", "destination"]); await command(repo, ["push", "upstream", "main"]); await command(repo, ["reset", "--hard", "HEAD~1"]); await command(repo, ["fetch", "upstream", "main"]);
  return { root, repo };
}
for (const format of ["sha1", "sha256"]) test(`concrete adapter fast-forwards an exact clean ${format} destination baseline`, async (t) => {
  let f: Awaited<ReturnType<typeof fixture>>; try { f = await fixture(format); } catch (error) { if (format === "sha256") return t.skip(`Git lacks sha256 support: ${String(error)}`); throw error; }
  try { const adapter = new NodeSyncGit(); const before = await adapter.observe(f.repo, "upstream", "main", "main"); assert.equal(before.ancestry, "behind"); await adapter.fastForward(f.repo, "upstream", "main", before.developmentSha, before.destinationSha); const after = await adapter.observe(f.repo, "upstream", "main", "main"); assert.equal(after.ancestry, "equal"); assert.equal(after.developmentSha, before.destinationSha); assert.equal(after.clean, true); assert.equal(await (await import("node:fs/promises")).readFile(join(f.repo, "app.ts"), "utf8"), "two\n"); } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("concrete adapter imports an exact named tag without moving main", async () => {
  const f = await fixture();
  try {
    await command(f.repo, ["tag", "v1"]); await command(f.repo, ["push", "upstream", "refs/tags/v1"]);
    const adapter = new NodeSyncGit(); const before = await command(f.repo, ["rev-parse", "main"]);
    const local = "refs/shipyard/source/upstream/test"; const imported = await adapter.importSource(f.repo, "upstream", "refs/tags/v1", local);
    assert.equal(await command(f.repo, ["rev-parse", "main"]), before); assert.equal(await command(f.repo, ["rev-parse", local]), imported); assert.equal(await adapter.resolveSource(f.repo, "upstream", "refs/tags/v1"), imported);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("a failing status observation is never reported as a clean worktree", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-sync-status-error-")); const executable = join(root, "git");
  try { await writeFile(executable, "#!/bin/sh\ncase \"$*\" in *\"status --porcelain\"*) exit 1;; *\"symbolic-ref\"*) echo main;; *\"remote get-url\"*) echo https://github.com/acme/dest.git;; *\"show-object-format\"*) echo sha1;; *\"refs/heads/main\"*) printf '%040d\\n' 1;; *\"refs/remotes/upstream/main\"*) printf '%040d\\n' 1;; *) exit 0;; esac\n"); await chmod(executable, 0o700); const adapter = new NodeSyncGit(executable); await assert.rejects(adapter.observe("/repo", "upstream", "main", "main")); } finally { await rm(root, { recursive: true, force: true }); }
});

test("dirty, wrong-branch, divergent, and path-policy failures preserve the exact ref snapshot", async (t) => {
  for (const scenario of ["dirty", "wrong-branch", "diverged", "path-policy"] as const) await t.test(scenario, async () => {
    const f = await fixture();
    try {
      if (scenario === "diverged") { await writeFile(join(f.repo, "side.ts"), "side\n"); await command(f.repo, ["add", "side.ts"]); await command(f.repo, ["commit", "-m", "side"]); }
      await command(f.repo, ["update-ref", "refs/shipyard/staged-development", "main"]); await command(f.repo, ["update-ref", "refs/shipyard/staged-destination", "refs/remotes/upstream/main"]);
      if (scenario === "dirty") await writeFile(join(f.repo, "dirty.txt"), "dirty\n");
      if (scenario === "wrong-branch") await command(f.repo, ["checkout", "-b", "feature/test"]);
      const repository = { owner: "acme", name: "destination", remote: { name: "upstream", url: await command(f.repo, ["remote", "get-url", "upstream"]) }, defaultBranch: "main" };
      const profile: Profile = { schemaVersion: 1, name: "test", actor: { login: "actor" }, topology: { kind: "single-repository", repository }, allowedOperations: ["sync"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: scenario === "path-policy" ? "src/**" : "**" }] } };
      const authority = { profileName: "test", commonDirectory: `${f.repo}/.git`, profileFingerprint: profileFingerprint(profile), actorLogin: "actor", topology: profile.topology } as const;
      const destinationSha = await command(f.repo, ["rev-parse", "refs/shipyard/staged-destination"]); const fs = new MemoryFilesystem();
      const service = new SyncService({ authority: { resolve: async () => authority }, profiles: { read: async () => profile }, git: new NodeSyncGit(), transport: { stage: async () => ({ repositoryPath: f.repo, destinationRef: "refs/shipyard/staged-destination", destinationSha, release: async () => {} }) }, ledger: { snapshot: async () => ({ head: undefined, records: {} }), transact: async () => { throw new Error("ledger must not run"); } }, locks: new MutationLockService(fs, new FakeProcess()), lockPath: () => "/lock" });
      const before = await command(f.repo, ["for-each-ref", "--format=%(refname):%(objectname)"]); await assert.rejects(service.sync({ repositoryPath: f.repo })); const after = await command(f.repo, ["for-each-ref", "--format=%(refname):%(objectname)"]); assert.equal(after, before);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
});
