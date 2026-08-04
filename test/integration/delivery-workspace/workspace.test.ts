import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
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
import type { WorktreeEnsureIntent } from "../../../src/workspace/service.js";
import { nodeProcess } from "../../../src/adapters/process.js";
import { FakeProcess, MemoryFilesystem } from "../../helpers/fakes.js";

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
async function initialRecord(value: Fixture, request: ReturnType<Fixture["request"]>) {
  return JSON.parse((await value.ledger.snapshot([request.initialLedgerPath])).records[request.initialLedgerPath]!);
}

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

test("rejects a registered delivery whose removed linked worktree also lost its feature ref without mutating durable state", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-missing-ref");
    await value.service.createOrResume(request);
    await git(request.worktreePath, ["commit", "--allow-empty", "-m", "later delivery history"]);
    const registryBefore = await value.registry.read();
    const ledgerBefore = await value.ledger.snapshot([request.initialLedgerPath]);

    await git(value.repository, ["worktree", "remove", request.worktreePath]);
    await git(value.repository, ["branch", "-D", request.branch]);

    await assert.rejects(value.service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
    assert.equal(await nodeWorkspaceGit.branchExists(value.repository, request.branch), false);
    assert.equal(await nodeWorkspaceGit.worktreeExists(request.worktreePath), false);
    assert.deepEqual(await value.registry.read(), registryBefore);
    assert.deepEqual(await value.ledger.snapshot([request.initialLedgerPath]), ledgerBefore);
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
    // Hold the first call after it has acquired the durable lock. This makes
    // the competing acquire deterministic instead of relying on scheduler
    // timing that sometimes allowed both operations to run sequentially.
    const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
    let blockOnce = true;
    const blockingLedger = {
      async snapshot(paths: readonly string[]) {
        if (blockOnce) { blockOnce = false; entered.resolve(); await release.promise; }
        return value.ledger.snapshot(paths);
      },
      transact: value.ledger.transact.bind(value.ledger),
    };
    const blockedService = new WorkspaceService(value.registry, blockingLedger, nodeWorkspaceGit, new MutationLockService(nodeFilesystem, nodeProcess));
    const first = blockedService.createOrResume(left);
    await entered.promise;
    await assert.rejects(value.service.createOrResume(right), (error: unknown) => error instanceof MutationLockError && error.code === "lock-held");
    release.resolve();
    await first;
    await value.service.createOrResume(right);
    assert.deepEqual((await value.registry.read())?.workspaces.map((workspace) => workspace.deliveryId).sort(), ["d-1", "d-2"]);
    assert.equal(Object.keys((await value.ledger.snapshot([left.initialLedgerPath, right.initialLedgerPath])).records).length, 2);
  } finally { await dispose(value); }
});

test("hands off a present registered worktree for manual cleanup, then removes absent-worktree registry state while retaining ledger history", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-1");
    await value.service.createOrResume(request);
    await writeFile(join(request.worktreePath, "uncommitted.txt"), "do not delete", "utf8");
    await assert.rejects(value.service.cleanup(value.repository, "d-1"), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-manual-cleanup");
    assert.equal((await value.registry.read())?.workspaces.length, 1);
    await git(value.repository, ["worktree", "remove", "--force", request.worktreePath]);
    await value.service.cleanup(value.repository, "d-1");
    assert.equal((await value.registry.read())?.workspaces.length, 0);
    assert.equal((await initialRecord(value, request)).payload, request.initialLedgerContents);
    const ledgerHead = (await value.ledger.snapshot([])).head!;
    await git(value.repository, ["branch", "-D", request.branch]);
    assert.equal(JSON.parse((await value.ledger.read(ledgerHead, [request.initialLedgerPath]))[request.initialLedgerPath]!).payload, request.initialLedgerContents);
  } finally { await dispose(value); }
});

test("does not delete a foreign replacement during cleanup's adversarial path swap", async () => {
  const request = { repositoryPath: "/repository", commonDirectory: "/repository/.git", deliveryId: "d-1", branch: "shipyard/d-1", worktreePath: "/worktrees/d-1", initialLedgerPath: "deliveries/d-1.json", initialLedgerContents: JSON.stringify({ deliveryId: "d-1" }) };
  let registryWrites = 0;
  let foreignReplacementExists = true;
  const registry = {
    async read() { return { schemaVersion: 1 as const, workspaces: [{ schemaVersion: 1 as const, deliveryId: request.deliveryId, commonDirectory: request.commonDirectory, branch: request.branch, worktreePath: request.worktreePath }] }; },
    async write() { registryWrites += 1; },
  };
  const ledger = { async snapshot() { return { head: undefined, records: {} }; }, async transact() { return "ledger"; } };
  const git = {
    async commonDirectory() { return request.commonDirectory; },
    // The original linked worktree was replaced between an unsafe hypothetical
    // identity check and path removal. Cleanup must not inspect or remove it.
    async worktreeExists() { return foreignReplacementExists; },
    async worktreeIdentity() { assert.fail("cleanup must not rely on a non-atomic identity recheck"); },
    async branchExists() { return false; }, async branchHead() { return undefined; }, async productHead() { return "a".repeat(40); },
    async ensureWorktree() { return false; },
  };
  const service = new WorkspaceService(registry, ledger, git, new MutationLockService(new MemoryFilesystem(), new FakeProcess()));

  await assert.rejects(service.cleanup(request.repositoryPath, request.deliveryId), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-manual-cleanup");
  assert.equal(foreignReplacementExists, true);
  assert.equal(registryWrites, 0);
});

test("cleanup removes registry state when its registered worktree is already absent", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-1");
    await value.service.createOrResume(request);
    const ledgerBefore = await value.ledger.snapshot([request.initialLedgerPath]);
    await git(value.repository, ["worktree", "remove", request.worktreePath]);

    await value.service.cleanup(value.repository, request.deliveryId);

    assert.equal((await value.registry.read())?.workspaces.length, 0);
    assert.deepEqual(await value.ledger.snapshot([request.initialLedgerPath]), ledgerBefore);
  } finally { await dispose(value); }
});

test("rejects a foreign canonical feature branch before creating ledger or worktree state", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-1");
    await git(value.repository, ["branch", request.branch]);
    await assert.rejects(value.service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
    assert.equal((await value.ledger.snapshot([request.initialLedgerPath])).head, undefined);
    assert.equal(await nodeWorkspaceGit.worktreeExists(request.worktreePath), false);
    assert.equal(await value.registry.read(), undefined);
  } finally { await dispose(value); }
});

test("resumes deterministically after faults following each durable creation boundary", async () => {
  const value = await fixture();
  try {
    const afterLedger = value.request("d-ledger");
    let failLedger = true;
    const ledgerFault = { snapshot: value.ledger.snapshot.bind(value.ledger), async transact(transaction: Parameters<GitLedgerStore["transact"]>[0]) { const result = await value.ledger.transact(transaction); if (failLedger) { failLedger = false; throw new Error("after-ledger"); } return result; } };
    await assert.rejects(new WorkspaceService(value.registry, ledgerFault, nodeWorkspaceGit, new MutationLockService(nodeFilesystem, nodeProcess)).createOrResume(afterLedger), /after-ledger/);
    assert.equal(await nodeWorkspaceGit.worktreeExists(afterLedger.worktreePath), false);
    await value.service.createOrResume(afterLedger);

    const afterWorktree = value.request("d-worktree");
    let failWorktree = true;
    const gitFault = { ...nodeWorkspaceGit, async ensureWorktree(repositoryPath: string, branch: string, path: string, intent: WorktreeEnsureIntent) { const created = await nodeWorkspaceGit.ensureWorktree(repositoryPath, branch, path, intent); if (failWorktree) { failWorktree = false; throw new Error("after-worktree"); } return created; } };
    await assert.rejects(new WorkspaceService(value.registry, value.ledger, gitFault, new MutationLockService(nodeFilesystem, nodeProcess)).createOrResume(afterWorktree), /after-worktree/);
    assert.equal(await nodeWorkspaceGit.worktreeExists(afterWorktree.worktreePath), true);
    await value.service.createOrResume(afterWorktree);

    const beforeRegistry = value.request("d-registry");
    let failRegistry = true;
    const registryFault = { read: value.registry.read.bind(value.registry), async write(document: Parameters<JsonDeliveryRegistry["write"]>[0]) { if (failRegistry) { failRegistry = false; throw new Error("before-registry"); } return value.registry.write(document); } };
    await assert.rejects(new WorkspaceService(registryFault, value.ledger, nodeWorkspaceGit, new MutationLockService(nodeFilesystem, nodeProcess)).createOrResume(beforeRegistry), /before-registry/);
    assert.equal(await nodeWorkspaceGit.worktreeExists(beforeRegistry.worktreePath), true);
    await value.service.createOrResume(beforeRegistry);
    assert.deepEqual((await value.registry.read())?.workspaces.map((workspace) => workspace.deliveryId).sort(), ["d-ledger", "d-registry", "d-worktree"]);
  } finally { await dispose(value); }
});

test("rejects a registry entry whose initial ledger record is missing without recreating it", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-1");
    await value.registry.write({ schemaVersion: 1, workspaces: [{ schemaVersion: 1, deliveryId: request.deliveryId, commonDirectory: value.commonDirectory, branch: request.branch, worktreePath: request.worktreePath }] });
    await assert.rejects(value.service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-ledger-conflict");
    assert.equal((await value.ledger.snapshot([request.initialLedgerPath])).head, undefined);
    assert.equal(await nodeWorkspaceGit.worktreeExists(request.worktreePath), false);
  } finally { await dispose(value); }
});

test("does not adopt a foreign branch created after the durable initial record", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-1");
    let failAfterLedger = true;
    const ledgerFault = { snapshot: value.ledger.snapshot.bind(value.ledger), async transact(transaction: Parameters<GitLedgerStore["transact"]>[0]) { const result = await value.ledger.transact(transaction); if (failAfterLedger) { failAfterLedger = false; throw new Error("after-ledger"); } return result; } };
    await assert.rejects(new WorkspaceService(value.registry, ledgerFault, nodeWorkspaceGit, new MutationLockService(nodeFilesystem, nodeProcess)).createOrResume(request), /after-ledger/);
    const provenance = await initialRecord(value, request);
    assert.equal(provenance.deliveryId, request.deliveryId);
    assert.equal(provenance.commonDirectory, value.commonDirectory);
    assert.equal(provenance.branch, request.branch);
    assert.equal(provenance.payload, request.initialLedgerContents);
    await writeFile(join(value.repository, "foreign.txt"), "foreign", "utf8"); await git(value.repository, ["add", "foreign.txt"]); await git(value.repository, ["commit", "-m", "foreign"]);
    await git(value.repository, ["branch", request.branch]);
    await assert.rejects(value.service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
    assert.equal(await nodeWorkspaceGit.worktreeExists(request.worktreePath), false);
  } finally { await dispose(value); }
});

test("retry after a same-SHA branch race fails closed without a registry entry", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-retry-race");
    let failAfterLedger = true;
    const ledgerFault = {
      snapshot: value.ledger.snapshot.bind(value.ledger),
      async transact(transaction: Parameters<GitLedgerStore["transact"]>[0]) {
        const result = await value.ledger.transact(transaction);
        if (failAfterLedger) { failAfterLedger = false; throw new Error("after-ledger"); }
        return result;
      },
    };
    await assert.rejects(new WorkspaceService(value.registry, ledgerFault, nodeWorkspaceGit, new MutationLockService(nodeFilesystem, nodeProcess)).createOrResume(request), /after-ledger/);
    const startSha = await nodeWorkspaceGit.productHead(value.repository);
    await git(value.repository, ["branch", request.branch, startSha]);

    await assert.rejects(value.service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
    assert.equal(await nodeWorkspaceGit.worktreeExists(request.worktreePath), false);
    assert.equal(await value.registry.read(), undefined);
  } finally { await dispose(value); }
});

test("create intent rejects a same-SHA foreign branch race without registry adoption or cleanup", async () => {
  const startSha = "a".repeat(40); const foreignSha = startSha;
  const request = { repositoryPath: "/repository", commonDirectory: "/repository/.git", deliveryId: "d-1", branch: "shipyard/d-1", worktreePath: "/worktrees/d-1", initialLedgerPath: "deliveries/d-1.json", initialLedgerContents: JSON.stringify({ deliveryId: "d-1" }) };
  let registryWrites = 0; let worktreeExists = false; let branchExists = false;
  const registry = { async read() { return undefined; }, async write() { registryWrites += 1; } };
  const records: Record<string, string> = {};
  const ledger = {
    async snapshot(paths: readonly string[]) { return { head: records[request.initialLedgerPath] ? "ledger" : undefined, records: Object.fromEntries(paths.flatMap((path) => records[path] === undefined ? [] : [[path, records[path]]])) }; },
    async transact(transaction: { writes: readonly { path: string; contents: string }[] }) { for (const write of transaction.writes) records[write.path] = write.contents; return "ledger"; },
  };
  const git = {
    async commonDirectory() { return request.commonDirectory; }, async worktreeExists() { return worktreeExists; },
    async worktreeIdentity() { return worktreeExists ? { commonDirectory: request.commonDirectory, branch: request.branch } : undefined; },
    async branchExists() { return branchExists; },
    async branchHead() { return branchExists ? foreignSha : undefined; }, async productHead() { return startSha; },
    async ensureWorktree(_repositoryPath: string, _branch: string, _path: string, intent: WorktreeEnsureIntent) {
      assert.deepEqual(intent, { mode: "create", startSha });
      branchExists = true;
      throw new Error("external branch won create race");
    },
  };
  const service = new WorkspaceService(registry, ledger, git, new MutationLockService(new MemoryFilesystem(), new FakeProcess()));

  await assert.rejects(service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
  assert.equal(registryWrites, 0);
  assert.equal(worktreeExists, false);
  assert.equal(await git.branchHead(), foreignSha);
});

test("does not remove a swapped path when the branch changes after created-worktree identity verification", async () => {
  const startSha = "a".repeat(40); const changedSha = "b".repeat(40);
  const request = { repositoryPath: "/repository", commonDirectory: "/repository/.git", deliveryId: "d-1", branch: "shipyard/d-1", worktreePath: "/worktrees/d-1", initialLedgerPath: "deliveries/d-1.json", initialLedgerContents: JSON.stringify({ deliveryId: "d-1" }) };
  let registryWrites = 0; let createdPathExists = false; let foreignReplacementExists = false; let removalAttempts = 0;
  const records: Record<string, string> = {};
  const registry = { async read() { return undefined; }, async write() { registryWrites += 1; } };
  const ledger = {
    async snapshot(paths: readonly string[]) { return { head: records[request.initialLedgerPath] ? "ledger" : undefined, records: Object.fromEntries(paths.flatMap((path) => records[path] === undefined ? [] : [[path, records[path]]])) }; },
    async transact(transaction: { writes: readonly { path: string; contents: string }[] }) { for (const write of transaction.writes) records[write.path] = write.contents; return "ledger"; },
  };
  const git = {
    async commonDirectory() { return request.commonDirectory; },
    async worktreeExists() { return createdPathExists || foreignReplacementExists; },
    async worktreeIdentity() { return createdPathExists ? { commonDirectory: request.commonDirectory, branch: request.branch } : undefined; },
    async branchExists() { return createdPathExists; }, async productHead() { return startSha; },
    async branchHead() {
      // The path is swapped after identity verification but before the old
      // implementation would have issued its path-based removal.
      createdPathExists = false; foreignReplacementExists = true;
      return changedSha;
    },
    async ensureWorktree() { createdPathExists = true; return true; },
    async removeWorktree() { removalAttempts += 1; foreignReplacementExists = false; },
  };
  const service = new WorkspaceService(registry, ledger, git, new MutationLockService(new MemoryFilesystem(), new FakeProcess()));

  await assert.rejects(service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
  assert.equal(foreignReplacementExists, true);
  assert.equal(removalAttempts, 0);
  assert.equal(registryWrites, 0);
  assert.ok(records[request.initialLedgerPath]);
});

test("real Git create intent preserves a same-SHA foreign branch created after preflight", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-race"); let foreignHead = ""; let injected = false;
    const racingGit = {
      ...nodeWorkspaceGit,
      async ensureWorktree(repositoryPath: string, branch: string, path: string, intent: WorktreeEnsureIntent) {
        assert.equal(intent.mode, "create");
        if (!injected) {
          injected = true;
          foreignHead = intent.startSha;
          await git(repositoryPath, ["branch", branch, foreignHead]);
        }
        return nodeWorkspaceGit.ensureWorktree(repositoryPath, branch, path, intent);
      },
    };
    const service = new WorkspaceService(value.registry, value.ledger, racingGit, new MutationLockService(nodeFilesystem, nodeProcess));
    await assert.rejects(service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
    assert.equal((await value.registry.read())?.workspaces.length ?? 0, 0);
    assert.equal(await nodeWorkspaceGit.worktreeExists(request.worktreePath), false);
    assert.equal(await nodeWorkspaceGit.branchHead(value.repository, request.branch), foreignHead);
  } finally { await dispose(value); }
});

test("workspace Git operations ignore hostile inherited repository-control variables", async () => {
  const value = await fixture();
  const redirected = await fixture();
  const inherited = Object.fromEntries(["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_CONFIG_GLOBAL", "DEVELOPER_DIR", "SDKROOT", "TOOLCHAINS"].map((key) => [key, process.env[key]]));
  try {
    process.env.GIT_DIR = join(redirected.repository, ".git"); process.env.GIT_WORK_TREE = redirected.repository; process.env.GIT_INDEX_FILE = join(redirected.repository, "index"); process.env.GIT_OBJECT_DIRECTORY = join(redirected.repository, ".git", "objects"); process.env.GIT_CONFIG_GLOBAL = join(redirected.root, "config");
    process.env.DEVELOPER_DIR = "/definitely-not-a-developer-directory"; process.env.SDKROOT = "/definitely-not-an-sdk"; process.env.TOOLCHAINS = "hostile-toolchain";
    const request = value.request("d-1"); await value.service.createOrResume(request);
    assert.equal((await nodeWorkspaceGit.worktreeIdentity(request.worktreePath))?.commonDirectory, value.commonDirectory);
    assert.equal(await nodeWorkspaceGit.branchExists(redirected.repository, request.branch), false);
  } finally {
    for (const [key, previous] of Object.entries(inherited)) previous === undefined ? delete process.env[key] : process.env[key] = previous;
    await dispose(value); await dispose(redirected);
  }
});

test("ledger and workspace production Git operations never execute a PATH-prepended git", async () => {
  const value = await fixture();
  const directory = await mkdtemp(join(tmpdir(), "shipyard-fake-git-"));
  const fakeGit = join(directory, "git");
  const executed = join(directory, "executed");
  const originalPath = process.env.PATH;
  try {
    await writeFile(fakeGit, `#!/bin/sh\n: > '${executed}'\nexit 99\n`, { mode: 0o700 });
    await chmod(fakeGit, 0o700);
    process.env.PATH = `${directory}:${originalPath ?? ""}`;

    await value.ledger.transact({ expectedHead: undefined, writes: [{ path: "records/path-safe", contents: "safe" }] });
    await value.service.createOrResume(value.request("d-path-safe"));

    await assert.rejects(access(executed), /ENOENT/);
    assert.equal((await nodeWorkspaceGit.worktreeIdentity(value.request("d-path-safe").worktreePath))?.branch, "shipyard/d-path-safe");
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await dispose(value); await rm(directory, { recursive: true, force: true });
  }
});
