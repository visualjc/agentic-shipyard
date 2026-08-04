import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createGitGraphSourceReader, graphCacheIdentity, graphLockPath, snapshotGraphSource, type GraphSourceReader } from "../../src/index.js";

test("disposable local Git fixture changes the fingerprint for staged, unstaged, rename and untracked states", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-graph-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  try {
    git("init"); git("config", "user.email", "fixture@example.test"); git("config", "user.name", "Fixture"); await writeFile(join(root, "a.txt"), "one\n"); git("add", "a.txt"); git("commit", "-m", "fixture");
    const reader: GraphSourceReader = { canonicalWorktree: async () => root, worktreeInstanceId: async () => `git-worktree-v1:${"a".repeat(64)}`, headSha: async () => git("rev-parse", "HEAD"), worktreeStatus: async () => execFileSync("git", ["-C", root, "status", "--porcelain=v2", "-z", "--untracked-files=all"], { encoding: "utf8" }) };
    const clean = await snapshotGraphSource(reader, root);
    await writeFile(join(root, "a.txt"), "two\n"); const dirty = await snapshotGraphSource(reader, root); assert.notEqual(dirty.workingTreeFingerprint, clean.workingTreeFingerprint);
    git("add", "a.txt"); const staged = await snapshotGraphSource(reader, root); assert.notEqual(staged.workingTreeFingerprint, dirty.workingTreeFingerprint);
    git("mv", "a.txt", "renamed.txt"); await writeFile(join(root, "untracked.txt"), "u\n"); const renamed = await snapshotGraphSource(reader, root); assert.notEqual(renamed.workingTreeFingerprint, staged.workingTreeFingerprint);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("real Git fingerprint covers deletion, executable mode, symlink, edit/revert, commit, checkout and rebase", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-graph-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  const reader: GraphSourceReader = { canonicalWorktree: async () => root, worktreeInstanceId: async () => `git-worktree-v1:${"b".repeat(64)}`, headSha: async () => git("rev-parse", "HEAD"), worktreeStatus: async () => execFileSync("git", ["-C", root, "status", "--porcelain=v2", "-z", "--untracked-files=all"], { encoding: "utf8" }) };
  try {
    git("init"); git("config", "user.email", "fixture@example.test"); git("config", "user.name", "Fixture"); await writeFile(join(root, "script"), "one\n"); git("add", "script"); git("commit", "-m", "base"); const baseBranch = git("branch", "--show-current");
    const clean = await snapshotGraphSource(reader, root);
    await chmod(join(root, "script"), 0o755); const executable = await snapshotGraphSource(reader, root); assert.notEqual(executable.workingTreeFingerprint, clean.workingTreeFingerprint);
    git("add", "script"); git("commit", "-m", "mode"); await symlink("script", join(root, "link")); const linked = await snapshotGraphSource(reader, root); assert.notEqual(linked.workingTreeFingerprint, clean.workingTreeFingerprint);
    git("add", "link"); git("commit", "-m", "link"); git("rm", "script"); const deleted = await snapshotGraphSource(reader, root); assert.notEqual(deleted.workingTreeFingerprint, linked.workingTreeFingerprint);
    git("restore", "--staged", "script"); git("restore", "script"); const reverted = await snapshotGraphSource(reader, root); assert.equal(reverted.workingTreeFingerprint, (await snapshotGraphSource(reader, root)).workingTreeFingerprint);
    const beforeCommit = reverted.headSha; await writeFile(join(root, "script"), "two\n"); git("add", "script"); git("commit", "-m", "change"); const committed = await snapshotGraphSource(reader, root); assert.notEqual(committed.headSha, beforeCommit);
    git("checkout", "-b", "topic", "HEAD~1"); await writeFile(join(root, "topic"), "t\n"); git("add", "topic"); git("commit", "-m", "topic"); git("rebase", baseBranch); const rebased = await snapshotGraphSource(reader, root); assert.notEqual(rebased.headSha, committed.headSha);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("two real linked divergent worktrees receive separate cache and lock identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-graph-")); const sibling = `${root}-sibling`;
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  try {
    git("init"); git("config", "user.email", "fixture@example.test"); git("config", "user.name", "Fixture"); await writeFile(join(root, "a"), "a\n"); git("add", "a"); git("commit", "-m", "base"); git("worktree", "add", "-b", "feature", sibling);
    await writeFile(join(sibling, "feature"), "f\n"); execFileSync("git", ["-C", sibling, "add", "feature"]); execFileSync("git", ["-C", sibling, "commit", "-m", "feature"]);
    const makeReader = (path: string, identity: string): GraphSourceReader => ({ canonicalWorktree: async () => path, worktreeInstanceId: async () => identity, headSha: async () => execFileSync("git", ["-C", path, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), worktreeStatus: async () => execFileSync("git", ["-C", path, "status", "--porcelain=v2", "-z"], { encoding: "utf8" }) });
    const [main, feature] = await Promise.all([snapshotGraphSource(makeReader(root, `git-worktree-v1:${"c".repeat(64)}`), root), snapshotGraphSource(makeReader(sibling, `git-worktree-v1:${"d".repeat(64)}`), sibling)]);
    const receipt = "graphify@0.9.32#00efd6e7969837ae4a9f11d8d504dcd3b20b09df";
    const [mainId, featureId] = [graphCacheIdentity("graphify", receipt, main), graphCacheIdentity("graphify", receipt, feature)];
    assert.notEqual(mainId, featureId); assert.notEqual(graphLockPath("/cache/main", mainId), graphLockPath("/cache/feature", featureId));
  } finally { await rm(sibling, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); }
});

test("production Git reader derives distinct identities when a linked-worktree path is recreated", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-graph-")); const linked = `${root}-linked`; const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  try {
    git("init"); git("config", "user.email", "fixture@example.test"); git("config", "user.name", "Fixture"); await writeFile(join(root, "a"), "a\n"); git("add", "a"); git("commit", "-m", "base");
    const reader = createGitGraphSourceReader(); git("worktree", "add", "-b", "recreated", linked); const first = await snapshotGraphSource(reader, linked);
    git("worktree", "remove", "--force", linked); git("worktree", "add", linked, "recreated"); const second = await snapshotGraphSource(reader, linked);
    assert.notEqual(first.worktreeInstanceId, second.worktreeInstanceId); assert.notEqual(graphCacheIdentity("graphify", "graphify@0.9.32#00efd6e7969837ae4a9f11d8d504dcd3b20b09df", first), graphCacheIdentity("graphify", "graphify@0.9.32#00efd6e7969837ae4a9f11d8d504dcd3b20b09df", second));
  } finally { await rm(linked, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); }
});

test("a real submodule change is part of the Git-native source fingerprint", async () => {
  const root = await mkdtemp(join(tmpdir(), "shipyard-graph-")); const sub = await mkdtemp(join(tmpdir(), "shipyard-graph-sub-"));
  const git = (path: string, ...args: string[]) => execFileSync("git", ["-C", path, ...args], { encoding: "utf8" }).trim();
  try {
    for (const path of [root, sub]) { git(path, "init"); git(path, "config", "user.email", "fixture@example.test"); git(path, "config", "user.name", "Fixture"); }
    await writeFile(join(sub, "sub"), "one\n"); git(sub, "add", "sub"); git(sub, "commit", "-m", "sub-one"); await writeFile(join(root, "root"), "r\n"); git(root, "add", "root"); git(root, "commit", "-m", "root");
    execFileSync("git", ["-C", root, "-c", "protocol.file.allow=always", "submodule", "add", sub, "vendor"]); git(root, "commit", "-am", "submodule");
    const reader: GraphSourceReader = { canonicalWorktree: async () => root, worktreeInstanceId: async () => `git-worktree-v1:${"e".repeat(64)}`, headSha: async () => git(root, "rev-parse", "HEAD"), worktreeStatus: async () => execFileSync("git", ["-C", root, "status", "--porcelain=v2", "-z", "--untracked-files=all"], { encoding: "utf8" }) };
    const clean = await snapshotGraphSource(reader, root); await writeFile(join(root, "vendor", "sub"), "two\n"); const changed = await snapshotGraphSource(reader, root); assert.notEqual(changed.workingTreeFingerprint, clean.workingTreeFingerprint);
  } finally { await rm(root, { recursive: true, force: true }); await rm(sub, { recursive: true, force: true }); }
});
