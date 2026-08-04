import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { nodeFilesystem } from "../../../src/adapters/filesystem.js";
import { GitLedgerStore } from "../../../src/adapters/ledger-git.js";
import { JsonDeliveryRegistry } from "../../../src/delivery/registry.js";
import { MutationLockError, MutationLockService } from "../../../src/locking/mutation-lock.js";
import { WorkspaceError } from "../../../src/workspace/errors.js";
import { nodeWorkspaceGit, WorkspaceService } from "../../../src/workspace/service.js";
import { nodeProcess } from "../../../src/adapters/process.js";

const exec = promisify(execFile);
async function git(repository: string, args: string[]): Promise<string> {
  return (await exec("git", ["-C", repository, ...args], { encoding: "utf8" })).stdout.trim();
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "shipyard-workspace-test-"));
  const repository = join(root, "repository");
  const worktrees = join(root, "worktrees");
  await mkdir(repository); await mkdir(worktrees);
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "test"]); await git(repository, ["config", "user.email", "test@example.test"]);
  await git(repository, ["commit", "--allow-empty", "-m", "product"]);
  const commonDirectory = await realpath(await git(repository, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const registry = new JsonDeliveryRegistry(nodeFilesystem, join(root, "state", "deliveries.json"));
  const ledger = new GitLedgerStore(repository);
  const service = new WorkspaceService(registry, ledger, nodeWorkspaceGit, new MutationLockService(nodeFilesystem, nodeProcess));
  const request = (deliveryId: string) => ({
    repositoryPath: repository, commonDirectory, deliveryId, branch: `shipyard/${deliveryId}`,
    worktreePath: join(worktrees, deliveryId), initialLedgerPath: `deliveries/${deliveryId}.json`, initialLedgerContents: JSON.stringify({ deliveryId }),
  });
  return { root, repository, commonDirectory, registry, ledger, service, request };
}

async function dispose(value: Fixture): Promise<void> { await rm(value.root, { recursive: true, force: true }); }

test("creates, resumes after interruption, and recreates a missing linked Git worktree without rewriting its ledger record", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-1");
    await value.service.createOrResume(request);
    const originalHead = (await value.ledger.snapshot([request.initialLedgerPath])).head;
    assert.equal((await nodeWorkspaceGit.worktreeIdentity(request.worktreePath))?.branch, request.branch);
    await git(value.repository, ["worktree", "remove", request.worktreePath]);
    await value.service.createOrResume(request);
    assert.equal((await value.ledger.snapshot([request.initialLedgerPath])).head, originalHead);
    assert.equal((await nodeWorkspaceGit.worktreeIdentity(request.worktreePath))?.commonDirectory, value.commonDirectory);
    assert.deepEqual((await value.registry.read())?.workspaces.map((workspace) => workspace.deliveryId), ["d-1"]);
  } finally { await dispose(value); }
});

test("refuses an arbitrary existing directory or a mismatched linked-worktree identity", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-1");
    await mkdir(request.worktreePath);
    await assert.rejects(value.service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-identity-mismatch");
    await rm(request.worktreePath, { recursive: true });
    await git(value.repository, ["worktree", "add", "-b", "shipyard/other", request.worktreePath]);
    await assert.rejects(value.service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-identity-mismatch");
  } finally { await dispose(value); }
});

test("serializes concurrent creators, preserves both registry entries after retry, and does not lose checkpoints", async () => {
  const value = await fixture();
  try {
    const left = value.request("d-1"); const right = value.request("d-2");
    const results = await Promise.allSettled([value.service.createOrResume(left), value.service.createOrResume(right)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected")!;
    assert.ok(rejected.reason instanceof MutationLockError && rejected.reason.code === "lock-held");
    const retry = rejected === results[0] ? left : right;
    await value.service.createOrResume(retry);
    assert.deepEqual((await value.registry.read())?.workspaces.map((workspace) => workspace.deliveryId).sort(), ["d-1", "d-2"]);
    assert.equal(Object.keys((await value.ledger.snapshot([left.initialLedgerPath, right.initialLedgerPath])).records).length, 2);
  } finally { await dispose(value); }
});

test("fails closed for a dirty worktree, then removes only rebuildable state while retaining its ledger history", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-1");
    await value.service.createOrResume(request);
    await writeFile(join(request.worktreePath, "uncommitted.txt"), "do not delete", "utf8");
    await assert.rejects(value.service.cleanup(value.repository, "d-1"), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-dirty");
    assert.equal((await value.registry.read())?.workspaces.length, 1);
    await rm(join(request.worktreePath, "uncommitted.txt"));
    await value.service.cleanup(value.repository, "d-1");
    assert.equal((await value.registry.read())?.workspaces.length, 0);
    assert.equal((await value.ledger.snapshot([request.initialLedgerPath])).records[request.initialLedgerPath], request.initialLedgerContents);
  } finally { await dispose(value); }
});
