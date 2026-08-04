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
    assert.equal((await initialRecord(value, request)).payload, request.initialLedgerContents);
    const ledgerHead = (await value.ledger.snapshot([])).head!;
    await git(value.repository, ["branch", "-D", request.branch]);
    assert.equal(JSON.parse((await value.ledger.read(ledgerHead, [request.initialLedgerPath]))[request.initialLedgerPath]!).payload, request.initialLedgerContents);
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
    const gitFault = { ...nodeWorkspaceGit, async ensureWorktree(repositoryPath: string, branch: string, path: string, startSha: string) { const created = await nodeWorkspaceGit.ensureWorktree(repositoryPath, branch, path, startSha); if (failWorktree) { failWorktree = false; throw new Error("after-worktree"); } return created; } };
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

test("fails closed when a deterministic Git fake creates the canonical branch during worktree add", async () => {
  const startSha = "a".repeat(40); const foreignSha = "b".repeat(40);
  const request = { repositoryPath: "/repository", commonDirectory: "/repository/.git", deliveryId: "d-1", branch: "shipyard/d-1", worktreePath: "/worktrees/d-1", initialLedgerPath: "deliveries/d-1.json", initialLedgerContents: JSON.stringify({ deliveryId: "d-1" }) };
  let registryWrites = 0; let worktreeExists = false; let branchExists = false; let removals = 0;
  const registry = { async read() { return undefined; }, async write() { registryWrites += 1; } };
  const records: Record<string, string> = {};
  const ledger = {
    async snapshot(paths: readonly string[]) { return { head: records[request.initialLedgerPath] ? "ledger" : undefined, records: Object.fromEntries(paths.flatMap((path) => records[path] === undefined ? [] : [[path, records[path]]])) }; },
    async transact(transaction: { writes: readonly { path: string; contents: string }[] }) { for (const write of transaction.writes) records[write.path] = write.contents; return "ledger"; },
  };
  const git = {
    async commonDirectory() { return request.commonDirectory; }, async worktreeExists() { return worktreeExists; },
    async worktreeIdentity() { return worktreeExists ? { commonDirectory: request.commonDirectory, branch: request.branch } : undefined; },
    async worktreeIsClean() { return true; }, async branchExists() { return branchExists; },
    async branchHead() { return branchExists ? foreignSha : undefined; }, async productHead() { return startSha; },
    async ensureWorktree() { branchExists = true; worktreeExists = true; return true; },
    async removeWorktree() { removals += 1; worktreeExists = false; },
  };
  const service = new WorkspaceService(registry, ledger, git, new MutationLockService(new MemoryFilesystem(), new FakeProcess()));

  await assert.rejects(service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
  assert.equal(registryWrites, 0);
  assert.equal(worktreeExists, false);
  assert.equal(await git.branchHead(), foreignSha);
  assert.equal(removals, 1);
});

test("fails closed when real Git creates the canonical branch between the preflight check and worktree add", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-race"); let foreignHead = ""; let injected = false;
    const racingGit = {
      ...nodeWorkspaceGit,
      async ensureWorktree(repositoryPath: string, branch: string, path: string, startSha: string) {
        if (!injected) {
          injected = true;
          await writeFile(join(repositoryPath, "foreign-race.txt"), "foreign", "utf8");
          await git(repositoryPath, ["add", "foreign-race.txt"]); await git(repositoryPath, ["commit", "-m", "foreign branch race"]);
          foreignHead = await git(repositoryPath, ["rev-parse", "HEAD"]); await git(repositoryPath, ["branch", branch]);
        }
        return nodeWorkspaceGit.ensureWorktree(repositoryPath, branch, path, startSha);
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
