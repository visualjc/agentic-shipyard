import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { NodeSingleRepositoryProductAuthority } from "../../../src/adapters/single-repository-git.js";
import { singleRepositoryPolicyDigest } from "../../../src/single-repository/policy.js";
import type { Profile } from "../../../src/contracts/types.js";

const execute = promisify(execFile);
async function git(repository: string, ...args: string[]): Promise<string> { return (await execute("git", ["-C", repository, ...args], { encoding: "utf8" })).stdout.trim(); }

test("read-only product authority certifies the exact clean branch tree with modes, symlinks, and Unicode paths", async () => {
  const repository = await mkdtemp(join(tmpdir(), "shipyard-single-product-"));
  try {
    await git(repository, "init", "-b", "main"); await git(repository, "config", "user.name", "Fixture"); await git(repository, "config", "user.email", "fixture@example.test");
    await writeFile(join(repository, "app.txt"), "hello\n"); await writeFile(join(repository, "run.sh"), "#!/bin/sh\nexit 0\n"); await chmod(join(repository, "run.sh"), 0o755); await symlink("app.txt", join(repository, "link")); await writeFile(join(repository, "replacement-�.txt"), "unicode\n");
    await git(repository, "add", "."); await git(repository, "commit", "-m", "base"); await git(repository, "switch", "-c", "shipyard/delivery"); await writeFile(join(repository, "app.txt"), "changed\n"); await git(repository, "commit", "-am", "delivery");
    const head = await git(repository, "rev-parse", "HEAD"), base = await git(repository, "rev-parse", "HEAD~1"), authority = new NodeSingleRepositoryProductAuthority("/usr/bin/git"), observation = await authority.observe({ repositoryPath: repository, branch: "shipyard/delivery", expectedHeadSha: head, expectedBaseSha: base });
    assert.equal(observation.headSha, head); assert.deepEqual(observation.entries.map((entry) => [entry.path, entry.mode]), [["app.txt", "100644"], ["link", "120000"], ["replacement-�.txt", "100644"], ["run.sh", "100755"]]);
    await writeFile(join(repository, "dirty.txt"), "dirty\n"); await assert.rejects(authority.observe({ repositoryPath: repository, branch: "shipyard/delivery", expectedHeadSha: head, expectedBaseSha: base }), /worktree, branch, or exact head changed/i);
    assert.equal(await git(repository, "status", "--porcelain"), "?? dirty.txt");
  } finally { await rm(repository, { recursive: true, force: true }); }
});

test("exact base-to-head delta retains deleted, renamed, and copied source paths for policy", async () => {
  const repository = await mkdtemp(join(tmpdir(), "shipyard-single-delta-"));
  const profile: Profile = { schemaVersion: 1, name: "single", actor: { login: "actor" }, topology: { kind: "single-repository", repository: { owner: "acme", name: "product", remote: { name: "origin", url: "https://github.com/acme/product.git" }, defaultBranch: "main" } }, allowedOperations: ["promote"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }, { owner: "context-overlay", pattern: ".ccpm/**" }, { owner: "context-overlay", pattern: "context/**" }, { owner: "destination-only", pattern: "shipyard-ledger/**" }] } };
  try {
    await git(repository, "init", "-b", "main"); await git(repository, "config", "user.name", "Fixture"); await git(repository, "config", "user.email", "fixture@example.test");
    await mkdir(join(repository, ".ccpm")); await mkdir(join(repository, "context")); await mkdir(join(repository, "src")); await writeFile(join(repository, ".ccpm", "intent.md"), "intent\n"); await writeFile(join(repository, "context", "source"), "context\n"); await writeFile(join(repository, "src", "delete.ts"), "delete\n"); await writeFile(join(repository, "src", "rename.ts"), "rename\n"); await writeFile(join(repository, "src", "copy.ts"), "copy\n"); await writeFile(join(repository, "src", "type-change"), "regular\n"); await git(repository, "add", "."); await git(repository, "commit", "-m", "base"); await git(repository, "switch", "-c", "shipyard/delivery");
    await git(repository, "rm", ".ccpm/intent.md"); await git(repository, "mv", "context/source", "src/from-context.ts"); await git(repository, "rm", "src/delete.ts"); await git(repository, "mv", "src/rename.ts", "src/renamed.ts"); await rm(join(repository, "src", "type-change")); await symlink("copy.ts", join(repository, "src", "type-change")); await writeFile(join(repository, "src", "copy-destination.ts"), "copy\n"); await git(repository, "add", "-A"); await git(repository, "commit", "-m", "delta");
    const authority = new NodeSingleRepositoryProductAuthority("/usr/bin/git"), head = await git(repository, "rev-parse", "HEAD"), base = await git(repository, "rev-parse", "HEAD~1"), observation = await authority.observe({ repositoryPath: repository, branch: "shipyard/delivery", expectedHeadSha: head, expectedBaseSha: base });
    assert.deepEqual(observation.touchedPaths, [...observation.touchedPaths].sort());
    for (const path of [".ccpm/intent.md", "context/source", "src/from-context.ts", "src/delete.ts", "src/rename.ts", "src/renamed.ts", "src/copy.ts", "src/copy-destination.ts", "src/type-change"]) assert.ok(observation.touchedPaths.includes(path), path);
    assert.deepEqual(observation.entries.find((entry) => entry.path === "src/type-change"), { path: "src/type-change", mode: "120000", objectId: (await git(repository, "rev-parse", "HEAD:src/type-change")) });
    assert.equal(observation.entries.some((entry) => entry.path === "src/delete.ts"), false);
    assert.throws(() => singleRepositoryPolicyDigest(profile, observation), /prohibited metadata|non-product cargo|No policy owner/i);
    const productOnly = { ...observation, touchedPaths: ["src/delete.ts", "src/rename.ts", "src/renamed.ts", "src/type-change"], entries: observation.entries.filter((entry) => entry.path.startsWith("src/")) };
    assert.match(singleRepositoryPolicyDigest(profile, productOnly), /^[a-f0-9]{64}$/);
  } finally { await rm(repository, { recursive: true, force: true }); }
});
