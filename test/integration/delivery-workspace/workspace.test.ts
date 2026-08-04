import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { nodeFilesystem } from "../../../src/adapters/filesystem.js";
import { GitLedgerStore } from "../../../src/adapters/ledger-git.js";
import { JsonDeliveryRegistry } from "../../../src/delivery/registry.js";
import type { DeliveryRegistryDocument, DeliveryWorkspace } from "../../../src/delivery/types.js";
import { createWorkspaceProofRecord, serializeWorkspaceProofRecord } from "../../../src/workspace/proof.js";
import type { WorkspaceProofRecord } from "../../../src/workspace/proof.js";
import { MutationLockError, MutationLockService } from "../../../src/locking/mutation-lock.js";
import { WorkspaceError } from "../../../src/workspace/errors.js";
import { nodeWorkspaceGit, WorkspaceService } from "../../../src/workspace/service.js";
import type { WorktreeEnsureIntent } from "../../../src/workspace/service.js";
import { nodeProcess } from "../../../src/adapters/process.js";
import { FakeProcess, MemoryFilesystem } from "../../helpers/fakes.js";

const exec = promisify(execFile);
const missingOwnershipMethods = {
  async ownershipProof() { return { exists: false } as const; },
  async verifyReadyWorkspace() { return false; },
};
async function git(repository: string, args: string[]): Promise<string> {
  return (await exec("git", ["-C", repository, ...args], { encoding: "utf8" })).stdout.trim();
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture(objectFormat: "sha1" | "sha256" = "sha1") {
  const root = await mkdtemp(join(tmpdir(), "shipyard-workspace-test-"));
  const repository = join(root, "repository");
  const worktrees = join(root, "worktrees");
  const state = join(root, "state");
  await mkdir(repository); await mkdir(worktrees); await mkdir(state);
  await git(repository, ["init", `--object-format=${objectFormat}`, "-b", "main"]);
  await git(repository, ["config", "user.name", "test"]); await git(repository, ["config", "user.email", "test@example.test"]);
  await git(repository, ["commit", "--allow-empty", "-m", "product"]);
  const commonDirectory = await realpath(await git(repository, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const registry = new JsonDeliveryRegistry(nodeFilesystem, join(state, "deliveries.json"));
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
async function assertProof(repositoryPath: string, workspace: DeliveryWorkspace, kind: "ownership" | "readiness", startProductSha: string): Promise<void> {
  const observation = kind === "ownership"
    ? await nodeWorkspaceGit.ownershipProof(repositoryPath, workspace.creationToken)
    : await nodeWorkspaceGit.readinessProof(repositoryPath, workspace.creationToken);
  assert.equal(observation.exists, true);
  assert.equal(observation.record?.schemaVersion, 1);
  assert.equal(observation.record?.kind, kind);
  assert.equal(observation.record?.creationToken, workspace.creationToken);
  assert.equal(observation.record?.deliveryId, workspace.deliveryId);
  assert.equal(observation.record?.commonDirectory, workspace.commonDirectory);
  assert.equal(observation.record?.branch, workspace.branch);
  assert.equal(observation.record?.worktreePath, workspace.worktreePath);
  assert.equal(observation.record?.startProductSha, startProductSha);
}

test("creates, resumes after interruption, and recreates a missing linked Git worktree without rewriting its ledger record", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-1");
    const firstWorkspace = await value.service.createOrResume(request);
    const originalHead = (await value.ledger.snapshot([request.initialLedgerPath])).head;
    assert.equal((await nodeWorkspaceGit.worktreeIdentity(request.worktreePath))?.branch, request.branch);
    await git(value.repository, ["worktree", "remove", request.worktreePath]);
    const resumedWorkspace = await value.service.createOrResume(request);
    assert.equal((await value.ledger.snapshot([request.initialLedgerPath])).head, originalHead);
    assert.equal((await nodeWorkspaceGit.worktreeIdentity(request.worktreePath))?.commonDirectory, value.commonDirectory);
    assert.equal(resumedWorkspace.creationToken, firstWorkspace.creationToken);
    assert.equal((await value.registry.read())?.workspaces[0]?.creationToken, firstWorkspace.creationToken);
    assert.deepEqual((await value.registry.read())?.workspaces.map((workspace) => workspace.deliveryId), ["d-1"]);
  } finally { await dispose(value); }
});

test("rejects non-string or empty initial ledger contents before touching any state", async () => {
  const request = { repositoryPath: "/repository", commonDirectory: "/repository/.git", deliveryId: "d-1", branch: "shipyard/d-1", worktreePath: "/worktrees/d-1", initialLedgerPath: "deliveries/d-1.json", initialLedgerContents: JSON.stringify({ deliveryId: "d-1" }) };
  let mutations = 0;
  const registry = { async lockScope() { mutations += 1; return { path: "/state/deliveries.json.lock", scope: "/state/deliveries.json" }; }, async read() { mutations += 1; return undefined; }, async write() { mutations += 1; } };
  const ledger = { async snapshot() { mutations += 1; return { head: undefined, records: {} }; }, async transact() { mutations += 1; return "ledger"; } };
  const git = {
    ...missingOwnershipMethods,
    async commonDirectory() { mutations += 1; return request.commonDirectory; }, async worktreeExists() { mutations += 1; return false; }, async worktreeIdentity() { mutations += 1; return undefined; },
    async branchExists() { mutations += 1; return false; }, async branchHead() { mutations += 1; return undefined; }, async productHead() { mutations += 1; return "a".repeat(40); },
    async createClaimedBranch() { mutations += 1; return true; }, async branchCreationMatches() { mutations += 1; return true; },
    async readinessProof() { mutations += 1; return { exists: false } as const; }, async createReadinessProof() { mutations += 1; return true; }, async ensureWorktree() { mutations += 1; return true; },
  };
  const service = new WorkspaceService(registry, ledger, git, new MutationLockService(new MemoryFilesystem(), new FakeProcess()));

  for (const initialLedgerContents of [undefined, 0, {}, ""] as const) {
    await assert.rejects(service.createOrResume({ ...request, initialLedgerContents } as never), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-invalid-input");
  }
  assert.equal(mutations, 0);
});

test("fails closed without readiness when a newly owned branch changes before attachment completes", async () => {
  const startSha = "a".repeat(40); const replacementSha = "b".repeat(40);
  const request = { repositoryPath: "/repository", commonDirectory: "/repository/.git", deliveryId: "d-1", branch: "shipyard/d-1", worktreePath: "/worktrees/d-1", initialLedgerPath: "deliveries/d-1.json", initialLedgerContents: JSON.stringify({ deliveryId: "d-1" }) };
  let document: DeliveryRegistryDocument | undefined; let branchExists = false; let attached = false; let ownership: WorkspaceProofRecord | undefined;
  const registry = { async lockScope() { return { path: "/state/deliveries.json.lock", scope: "/state/deliveries.json" }; }, async read() { return document; }, async write(next: DeliveryRegistryDocument) { document = next; } };
  const records: Record<string, string> = {};
  const ledger = { async snapshot(paths: readonly string[]) { return { head: records[request.initialLedgerPath] ? "ledger" : undefined, records: Object.fromEntries(paths.flatMap((path) => records[path] === undefined ? [] : [[path, records[path]]])) }; }, async transact(transaction: { writes: readonly { path: string; contents: string }[] }) { for (const write of transaction.writes) records[write.path] = write.contents; return "ledger"; } };
  const git = {
    ...missingOwnershipMethods,
    async commonDirectory() { return request.commonDirectory; }, async worktreeExists() { return attached; }, async worktreeIdentity() { return attached ? { commonDirectory: request.commonDirectory, branch: request.branch } : undefined; },
    async branchExists() { return branchExists; }, async branchHead() { return replacementSha; }, async productHead() { return startSha; },
    async createClaimedBranch(_repositoryPath: string, _branch: string, _startSha: string, record: WorkspaceProofRecord) { branchExists = true; ownership = record; return true; },
    async ownershipProof() { return ownership ? { exists: true as const, record: ownership } : { exists: false as const }; },
    async readinessProof() { return { exists: false } as const; }, async createReadinessProof() { return true; }, async ensureWorktree() { attached = true; return true; },
  };
  const service = new WorkspaceService(registry, ledger, git, new MutationLockService(new MemoryFilesystem(), new FakeProcess()));

  await assert.rejects(service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
  assert.equal(attached, true);
  assert.equal(document?.workspaces[0]?.state, "creating");
});

test("never promotes when the atomic readiness transaction reports a concurrent change", async () => {
  const startSha = "a".repeat(40);
  const request = { repositoryPath: "/repository", commonDirectory: "/repository/.git", deliveryId: "d-1", branch: "shipyard/d-1", worktreePath: "/worktrees/d-1", initialLedgerPath: "deliveries/d-1.json", initialLedgerContents: JSON.stringify({ deliveryId: "d-1" }) };
  let document: DeliveryRegistryDocument | undefined; let branchExists = false; let attached = false; let ownership: WorkspaceProofRecord | undefined;
  const registry = { async lockScope() { return { path: "/state/deliveries.json.lock", scope: "/state/deliveries.json" }; }, async read() { return document; }, async write(next: DeliveryRegistryDocument) { document = next; } };
  const records: Record<string, string> = {};
  const ledger = { async snapshot(paths: readonly string[]) { return { head: records[request.initialLedgerPath] ? "ledger" : undefined, records: Object.fromEntries(paths.flatMap((path) => records[path] === undefined ? [] : [[path, records[path]]])) }; }, async transact(transaction: { writes: readonly { path: string; contents: string }[] }) { for (const write of transaction.writes) records[write.path] = write.contents; return "ledger"; } };
  const git = {
    ...missingOwnershipMethods,
    async commonDirectory() { return request.commonDirectory; }, async worktreeExists() { return attached; }, async worktreeIdentity() { return attached ? { commonDirectory: request.commonDirectory, branch: request.branch } : undefined; },
    async branchExists() { return branchExists; }, async branchHead() { return startSha; }, async productHead() { return startSha; },
    async createClaimedBranch(_repositoryPath: string, _branch: string, _startSha: string, record: WorkspaceProofRecord) { branchExists = true; ownership = record; return true; },
    async ownershipProof() { return ownership ? { exists: true as const, record: ownership } : { exists: false as const }; },
    async readinessProof() { return { exists: false } as const; }, async createReadinessProof() { return false; }, async ensureWorktree() { attached = true; return true; },
  };
  const service = new WorkspaceService(registry, ledger, git, new MutationLockService(new MemoryFilesystem(), new FakeProcess()));

  await assert.rejects(service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
  assert.equal(attached, true);
  assert.equal(document?.workspaces[0]?.state, "creating");
});

test("linearizes readiness before a branch move triggered inside the ready registry write", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-linearized");
    const startSha = await nodeWorkspaceGit.productHead(value.repository);
    let movedDuringReadyWrite = false;
    const registry = {
      lockScope: value.registry.lockScope.bind(value.registry), read: value.registry.read.bind(value.registry),
      async write(document: DeliveryRegistryDocument) {
        const workspace = document.workspaces.find(candidate => candidate.deliveryId === request.deliveryId);
        if (workspace?.state === "ready") {
          await assertProof(value.repository, workspace, "ownership", startSha);
          await assertProof(value.repository, workspace, "readiness", startSha);
          await git(request.worktreePath, ["commit", "--allow-empty", "-m", "move during ready registry write"]);
          movedDuringReadyWrite = true;
        }
        await value.registry.write(document);
      },
    };
    const service = new WorkspaceService(registry, value.ledger, nodeWorkspaceGit, new MutationLockService(nodeFilesystem, nodeProcess));

    const workspace = await service.createOrResume(request);
    assert.equal(movedDuringReadyWrite, true);
    assert.notEqual(await nodeWorkspaceGit.branchHead(value.repository, request.branch), startSha);
    assert.equal((await value.registry.read())?.workspaces[0]?.state, "ready");
    await assertProof(value.repository, workspace, "readiness", startSha);
  } finally { await dispose(value); }
});

test("resumes a crash after readiness proof without requiring the branch to remain at its start SHA", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-proof-resume");
    const startSha = await nodeWorkspaceGit.productHead(value.repository);
    let failReadyWrite = true;
    const registry = {
      lockScope: value.registry.lockScope.bind(value.registry), read: value.registry.read.bind(value.registry),
      async write(document: DeliveryRegistryDocument) {
        const workspace = document.workspaces.find(candidate => candidate.deliveryId === request.deliveryId);
        if (workspace?.state === "ready" && failReadyWrite) {
          failReadyWrite = false;
          await assertProof(value.repository, workspace, "readiness", startSha);
          throw new Error("crash-after-readiness-proof");
        }
        await value.registry.write(document);
      },
    };
    const interrupted = new WorkspaceService(registry, value.ledger, nodeWorkspaceGit, new MutationLockService(nodeFilesystem, nodeProcess));

    await assert.rejects(interrupted.createOrResume(request), /crash-after-readiness-proof/);
    const creating = (await value.registry.read())?.workspaces[0];
    assert.equal(creating?.state, "creating");
    await git(value.repository, ["reflog", "expire", "--expire=now", "--all"]);
    await git(value.repository, ["gc", "--prune=now"]);
    await assertProof(value.repository, creating!, "ownership", startSha);
    await assertProof(value.repository, creating!, "readiness", startSha);
    await git(request.worktreePath, ["commit", "--allow-empty", "-m", "delivery work after readiness"]);
    const advancedSha = await nodeWorkspaceGit.branchHead(value.repository, request.branch);
    assert.notEqual(advancedSha, startSha);
    await git(value.repository, ["worktree", "remove", request.worktreePath]);
    assert.equal(await nodeWorkspaceGit.worktreeExists(request.worktreePath), false);

    const resumed = await value.service.createOrResume(request);
    assert.equal(resumed.state, "ready");
    assert.equal((await nodeWorkspaceGit.worktreeIdentity(request.worktreePath))?.branch, request.branch);
    assert.equal(await nodeWorkspaceGit.branchHead(value.repository, request.branch), advancedSha);
    assert.equal((await value.registry.read())?.workspaces[0]?.state, "ready");
    assert.equal((await value.service.createOrResume(request)).state, "ready");
  } finally { await dispose(value); }
});

test("rejects a mismatched token readiness proof without promoting its creating claim", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-proof-mismatch");
    const workspace = await value.service.createOrResume(request);
    const proofRef = `refs/shipyard/workspace-readiness/${workspace.creationToken}`;
    await git(value.repository, ["commit", "--allow-empty", "-m", "foreign proof target"]);
    const foreignSha = await nodeWorkspaceGit.productHead(value.repository);
    await git(value.repository, ["update-ref", "-m", "foreign-readiness-proof", proofRef, foreignSha]);
    const ready = (await value.registry.read())!;
    await value.registry.write({ schemaVersion: 1, workspaces: ready.workspaces.map(candidate => candidate.deliveryId === request.deliveryId ? { ...candidate, state: "creating" } : candidate) });

    await assert.rejects(value.service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict" && error.message.includes("readiness proof"));
    assert.equal((await value.registry.read())?.workspaces[0]?.state, "creating");
    assert.deepEqual(await nodeWorkspaceGit.readinessProof(value.repository, workspace.creationToken), { exists: true });
  } finally { await dispose(value); }
});

test("ready service resumes reject deleted ownership or readiness proof refs", async () => {
  for (const kind of ["ownership", "readiness"] as const) {
    const value = await fixture();
    try {
      const request = value.request(`d-ready-missing-${kind}`);
      const workspace = await value.service.createOrResume(request);
      await git(value.repository, ["update-ref", "-d", `refs/shipyard/workspace-${kind}/${workspace.creationToken}`]);

      await assert.rejects(value.service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict" && error.message.includes("ready delivery"));
      assert.equal((await value.registry.read())?.workspaces[0]?.state, "ready");
    } finally { await dispose(value); }
  }
});

test("ready service resumes reject a foreign object behind an existing proof ref", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-ready-foreign-proof");
    const workspace = await value.service.createOrResume(request);
    const productSha = await nodeWorkspaceGit.productHead(value.repository);
    await git(value.repository, ["update-ref", `refs/shipyard/workspace-ownership/${workspace.creationToken}`, productSha]);

    await assert.rejects(value.service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict" && error.message.includes("ownership proof"));
    assert.deepEqual(await nodeWorkspaceGit.ownershipProof(value.repository, workspace.creationToken), { exists: true });
    assert.equal((await value.registry.read())?.workspaces[0]?.state, "ready");
  } finally { await dispose(value); }
});

test("an exact readiness blob cannot substitute for the atomic branch ownership proof", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-readiness-only");
    let interrupt = true;
    const registry = {
      lockScope: value.registry.lockScope.bind(value.registry), read: value.registry.read.bind(value.registry),
      async write(document: DeliveryRegistryDocument) {
        await value.registry.write(document);
        if (interrupt) { interrupt = false; throw new Error("after-creating-claim"); }
      },
    };
    const interrupted = new WorkspaceService(registry, value.ledger, nodeWorkspaceGit, new MutationLockService(nodeFilesystem, nodeProcess));
    await assert.rejects(interrupted.createOrResume(request), /after-creating-claim/);
    const claim = (await value.registry.read())!.workspaces[0];
    const startSha = (await initialRecord(value, request)).startProductSha as string;
    await git(value.repository, ["branch", request.branch, startSha]);
    const proofPath = join(value.root, "forged-readiness.json");
    await writeFile(proofPath, serializeWorkspaceProofRecord(createWorkspaceProofRecord("readiness", claim, startSha)), "utf8");
    const blob = await git(value.repository, ["hash-object", "-w", proofPath]);
    await git(value.repository, ["update-ref", `refs/shipyard/workspace-readiness/${claim.creationToken}`, blob]);

    await assert.rejects(value.service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict" && error.message.includes("ownership proof"));
    assert.deepEqual(await nodeWorkspaceGit.ownershipProof(value.repository, claim.creationToken), { exists: false });
    assert.equal(await nodeWorkspaceGit.worktreeExists(request.worktreePath), false);
    assert.equal((await value.registry.read())?.workspaces[0]?.state, "creating");
  } finally { await dispose(value); }
});

test("atomic readiness proof creation rejects a branch move immediately before its transaction", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-proof-race");
    let injected = false;
    const racingGit = {
      ...nodeWorkspaceGit,
      async createReadinessProof(repositoryPath: string, branch: string, startSha: string, ownership: WorkspaceProofRecord, readiness: WorkspaceProofRecord) {
        if (!injected) {
          injected = true;
          await git(request.worktreePath, ["commit", "--allow-empty", "-m", "move immediately before readiness transaction"]);
        }
        return nodeWorkspaceGit.createReadinessProof(repositoryPath, branch, startSha, ownership, readiness);
      },
    };
    const service = new WorkspaceService(value.registry, value.ledger, racingGit, new MutationLockService(nodeFilesystem, nodeProcess));

    await assert.rejects(service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
    const creating = (await value.registry.read())?.workspaces[0];
    assert.equal(creating?.state, "creating");
    assert.deepEqual(await nodeWorkspaceGit.readinessProof(value.repository, creating!.creationToken), { exists: false });
  } finally { await dispose(value); }
});

test("creates exact token readiness proofs in SHA-1 and SHA-256 repositories", async () => {
  for (const [objectFormat, length] of [["sha1", 40], ["sha256", 64]] as const) {
    const value = await fixture(objectFormat);
    try {
      const request = value.request(`d-${objectFormat}`);
      const startSha = await nodeWorkspaceGit.productHead(value.repository);
      const workspace = await value.service.createOrResume(request);
      assert.equal(startSha.length, length);
      await assertProof(value.repository, workspace, "ownership", startSha);
      await assertProof(value.repository, workspace, "readiness", startSha);
    } finally { await dispose(value); }
  }
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

test("create intent refuses any pre-existing path, including arbitrary and mismatched worktrees", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-1");
    await mkdir(request.worktreePath);
    await assert.rejects(value.service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
    await rm(request.worktreePath, { recursive: true });
    await git(value.repository, ["worktree", "add", "-b", "shipyard/other", request.worktreePath]);
    await assert.rejects(value.service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
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

test("serializes two Git repositories through symlinked registry aliases without losing either entry", async () => {
  const left = await fixture();
  const right = await fixture();
  const stateRoot = await mkdtemp(join(tmpdir(), "shipyard-registry-alias-test-"));
  try {
    assert.notEqual(left.commonDirectory, right.commonDirectory);
    const physicalState = join(stateRoot, "physical-state");
    const aliasState = join(stateRoot, "state-alias");
    await mkdir(physicalState);
    await symlink(physicalState, aliasState);
    const leftRegistry = new JsonDeliveryRegistry(nodeFilesystem, join(physicalState, "deliveries.json"));
    const rightRegistry = new JsonDeliveryRegistry(nodeFilesystem, join(aliasState, "deliveries.json"));
    assert.deepEqual(await leftRegistry.lockScope(), await rightRegistry.lockScope());
    const leftRequest = left.request("d-shared-left");
    const rightRequest = right.request("d-shared-right");
    const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
    let blockOnce = true;
    const blockingLedger = {
      async snapshot(paths: readonly string[]) {
        if (blockOnce) { blockOnce = false; entered.resolve(); await release.promise; }
        return left.ledger.snapshot(paths);
      },
      transact: left.ledger.transact.bind(left.ledger),
    };
    const leftService = new WorkspaceService(leftRegistry, blockingLedger, nodeWorkspaceGit, new MutationLockService(nodeFilesystem, nodeProcess));
    const rightService = new WorkspaceService(rightRegistry, right.ledger, nodeWorkspaceGit, new MutationLockService(nodeFilesystem, nodeProcess));

    const first = leftService.createOrResume(leftRequest);
    await entered.promise;
    await assert.rejects(rightService.createOrResume(rightRequest), (error: unknown) => error instanceof MutationLockError && error.code === "lock-held");
    release.resolve();
    await first;
    await rightService.createOrResume(rightRequest);

    assert.deepEqual((await leftRegistry.read())?.workspaces.map((workspace) => workspace.deliveryId).sort(), ["d-shared-left", "d-shared-right"]);
  } finally { await dispose(left); await dispose(right); await rm(stateRoot, { recursive: true, force: true }); }
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
    await assert.rejects(value.service.cleanup(value.repository, "d-1"), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-manual-cleanup");
    await git(value.repository, ["branch", "-D", request.branch]);
    await value.service.cleanup(value.repository, "d-1");
    assert.equal((await value.registry.read())?.workspaces.length, 0);
    assert.equal((await initialRecord(value, request)).payload, request.initialLedgerContents);
    const ledgerHead = (await value.ledger.snapshot([])).head!;
    assert.equal(JSON.parse((await value.ledger.read(ledgerHead, [request.initialLedgerPath]))[request.initialLedgerPath]!).payload, request.initialLedgerContents);
  } finally { await dispose(value); }
});

test("does not delete a foreign replacement during cleanup's adversarial path swap", async () => {
  const request = { repositoryPath: "/repository", commonDirectory: "/repository/.git", deliveryId: "d-1", branch: "shipyard/d-1", worktreePath: "/worktrees/d-1", initialLedgerPath: "deliveries/d-1.json", initialLedgerContents: JSON.stringify({ deliveryId: "d-1" }) };
  let registryWrites = 0;
  let foreignReplacementExists = true;
  const registry = {
    async lockScope() { return { path: "/state/deliveries.json.lock", scope: "/state/deliveries.json" }; },
    async read() { return { schemaVersion: 1 as const, workspaces: [{ schemaVersion: 1 as const, state: "ready" as const, creationToken: "11111111-1111-4111-8111-111111111111", deliveryId: request.deliveryId, commonDirectory: request.commonDirectory, branch: request.branch, worktreePath: request.worktreePath }] }; },
    async write() { registryWrites += 1; },
  };
  const ledger = { async snapshot() { return { head: undefined, records: {} }; }, async transact() { return "ledger"; } };
  const git = {
    ...missingOwnershipMethods,
    async commonDirectory() { return request.commonDirectory; },
    // The original linked worktree was replaced between an unsafe hypothetical
    // identity check and path removal. Cleanup must not inspect or remove it.
    async worktreeExists() { return foreignReplacementExists; },
    async worktreeIdentity() { assert.fail("cleanup must not rely on a non-atomic identity recheck"); },
    async branchExists() { return false; }, async branchHead() { return undefined; }, async productHead() { return "a".repeat(40); },
    async createClaimedBranch() { return false; }, async branchCreationMatches() { return false; },
    async readinessProof() { return { exists: false } as const; }, async createReadinessProof() { return false; },
    async ensureWorktree() { return false; },
  };
  const service = new WorkspaceService(registry, ledger, git, new MutationLockService(new MemoryFilesystem(), new FakeProcess()));

  await assert.rejects(service.cleanup(request.repositoryPath, request.deliveryId), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-manual-cleanup");
  assert.equal(foreignReplacementExists, true);
  assert.equal(registryWrites, 0);
});

test("cleanup keeps a claim while its branch remains, then removes it after both Git objects are absent", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-1");
    await value.service.createOrResume(request);
    const ledgerBefore = await value.ledger.snapshot([request.initialLedgerPath]);
    await git(value.repository, ["worktree", "remove", request.worktreePath]);
    await assert.rejects(value.service.cleanup(value.repository, request.deliveryId), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-manual-cleanup");
    await git(value.repository, ["branch", "-D", request.branch]);
    await value.service.cleanup(value.repository, request.deliveryId);

    assert.equal((await value.registry.read())?.workspaces.length, 0);
    assert.deepEqual(await value.ledger.snapshot([request.initialLedgerPath]), ledgerBefore);
  } finally { await dispose(value); }
});

test("cleanup retains token proofs while a reused delivery ID creates distinct new proofs", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-reused");
    const startSha = await nodeWorkspaceGit.productHead(value.repository);
    const first = await value.service.createOrResume(request);
    await git(value.repository, ["worktree", "remove", request.worktreePath]);
    await git(value.repository, ["branch", "-D", request.branch]);
    await value.service.cleanup(value.repository, request.deliveryId);

    const second = await value.service.createOrResume(request);
    assert.notEqual(second.creationToken, first.creationToken);
    await assertProof(value.repository, first, "ownership", startSha);
    await assertProof(value.repository, first, "readiness", startSha);
    await assertProof(value.repository, second, "ownership", startSha);
    await assertProof(value.repository, second, "readiness", startSha);
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

test("every claimed initialization boundary resumes without deleting branch or worktree state", async () => {
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
    const registryFault = { lockScope: value.registry.lockScope.bind(value.registry), read: value.registry.read.bind(value.registry), async write(document: Parameters<JsonDeliveryRegistry["write"]>[0]) { if (failRegistry) { failRegistry = false; throw new Error("before-registry"); } return value.registry.write(document); } };
    await assert.rejects(new WorkspaceService(registryFault, value.ledger, nodeWorkspaceGit, new MutationLockService(nodeFilesystem, nodeProcess)).createOrResume(beforeRegistry), /before-registry/);
    assert.equal(await nodeWorkspaceGit.worktreeExists(beforeRegistry.worktreePath), false);
    await value.service.createOrResume(beforeRegistry);
    assert.deepEqual((await value.registry.read())?.workspaces.map((workspace) => workspace.deliveryId).sort(), ["d-ledger", "d-registry", "d-worktree"]);
  } finally { await dispose(value); }
});

test("a registry-first creating claim resumes branch-only state, but rejects a wrong creating head", async () => {
  const value = await fixture();
  try {
    const registryOnly = value.request("d-registry-only");
    let interrupt = true;
    const faultingRegistry = {
      lockScope: value.registry.lockScope.bind(value.registry), read: value.registry.read.bind(value.registry),
      async write(document: Parameters<JsonDeliveryRegistry["write"]>[0]) {
        await value.registry.write(document);
        if (interrupt) { interrupt = false; throw new Error("after-registry-claim"); }
      },
    };
    await assert.rejects(new WorkspaceService(faultingRegistry, value.ledger, nodeWorkspaceGit, new MutationLockService(nodeFilesystem, nodeProcess)).createOrResume(registryOnly), /after-registry-claim/);
    assert.equal((await value.registry.read())?.workspaces.find((workspace) => workspace.deliveryId === registryOnly.deliveryId)?.state, "creating");
    assert.equal(await nodeWorkspaceGit.branchExists(value.repository, registryOnly.branch), false);
    await value.service.createOrResume(registryOnly);

    const branchOnly = value.request("d-branch-only");
    let branchInterrupt = true;
    const branchClaimRegistry = {
      lockScope: value.registry.lockScope.bind(value.registry), read: value.registry.read.bind(value.registry),
      async write(document: Parameters<JsonDeliveryRegistry["write"]>[0]) {
        await value.registry.write(document);
        if (branchInterrupt) { branchInterrupt = false; throw new Error("after-branch-claim"); }
      },
    };
    await assert.rejects(new WorkspaceService(branchClaimRegistry, value.ledger, nodeWorkspaceGit, new MutationLockService(nodeFilesystem, nodeProcess)).createOrResume(branchOnly), /after-branch-claim/);
    let stopBeforeWorktree = true;
    const branchOnlyGit = {
      ...nodeWorkspaceGit,
      async ensureWorktree(repositoryPath: string, branch: string, path: string, intent: WorktreeEnsureIntent) {
        if (stopBeforeWorktree) { stopBeforeWorktree = false; throw new Error("after-claimed-branch"); }
        return nodeWorkspaceGit.ensureWorktree(repositoryPath, branch, path, intent);
      },
    };
    await assert.rejects(new WorkspaceService(value.registry, value.ledger, branchOnlyGit, new MutationLockService(nodeFilesystem, nodeProcess)).createOrResume(branchOnly), /after-claimed-branch/);
    assert.equal(await nodeWorkspaceGit.branchExists(value.repository, branchOnly.branch), true);
    assert.equal(await nodeWorkspaceGit.worktreeExists(branchOnly.worktreePath), false);
    await value.service.createOrResume(branchOnly);

    const wrongHead = value.request("d-wrong-head");
    let wrongInterrupt = true;
    const wrongClaimRegistry = {
      lockScope: value.registry.lockScope.bind(value.registry), read: value.registry.read.bind(value.registry),
      async write(document: Parameters<JsonDeliveryRegistry["write"]>[0]) {
        await value.registry.write(document);
        if (wrongInterrupt) { wrongInterrupt = false; throw new Error("after-wrong-claim"); }
      },
    };
    await assert.rejects(new WorkspaceService(wrongClaimRegistry, value.ledger, nodeWorkspaceGit, new MutationLockService(nodeFilesystem, nodeProcess)).createOrResume(wrongHead), /after-wrong-claim/);
    await writeFile(join(value.repository, "wrong-head.txt"), "foreign", "utf8"); await git(value.repository, ["add", "wrong-head.txt"]); await git(value.repository, ["commit", "-m", "foreign"]);
    await git(value.repository, ["branch", wrongHead.branch]);
    await assert.rejects(value.service.createOrResume(wrongHead), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
    assert.equal(await nodeWorkspaceGit.worktreeExists(wrongHead.worktreePath), false);
  } finally { await dispose(value); }
});

test("rejects a registry entry whose initial ledger record is missing without recreating it", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-1");
    await value.registry.write({ schemaVersion: 1, workspaces: [{ schemaVersion: 1, state: "creating", creationToken: "11111111-1111-4111-8111-111111111111", deliveryId: request.deliveryId, commonDirectory: value.commonDirectory, branch: request.branch, worktreePath: request.worktreePath }] });
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
  const registry = { async lockScope() { return { path: "/state/deliveries.json.lock", scope: "/state/deliveries.json" }; }, async read() { return undefined; }, async write() { registryWrites += 1; } };
  const records: Record<string, string> = {};
  const ledger = {
    async snapshot(paths: readonly string[]) { return { head: records[request.initialLedgerPath] ? "ledger" : undefined, records: Object.fromEntries(paths.flatMap((path) => records[path] === undefined ? [] : [[path, records[path]]])) }; },
    async transact(transaction: { writes: readonly { path: string; contents: string }[] }) { for (const write of transaction.writes) records[write.path] = write.contents; return "ledger"; },
  };
  const git = {
    ...missingOwnershipMethods,
    async commonDirectory() { return request.commonDirectory; }, async worktreeExists() { return worktreeExists; },
    async worktreeIdentity() { return worktreeExists ? { commonDirectory: request.commonDirectory, branch: request.branch } : undefined; },
    async branchExists() { return branchExists; },
    async branchHead() { return branchExists ? foreignSha : undefined; }, async productHead() { return startSha; },
    async createClaimedBranch() { branchExists = true; return false; }, async branchCreationMatches() { return false; },
    async readinessProof() { return { exists: false } as const; }, async createReadinessProof() { return false; },
    async ensureWorktree(_repositoryPath: string, _branch: string, _path: string, intent: WorktreeEnsureIntent) {
      assert.deepEqual(intent, { mode: "create", startSha });
      branchExists = true;
      throw new Error("external branch won create race");
    },
  };
  const service = new WorkspaceService(registry, ledger, git, new MutationLockService(new MemoryFilesystem(), new FakeProcess()));

  await assert.rejects(service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
  assert.equal(registryWrites, 1);
  assert.equal(worktreeExists, false);
  assert.equal(await git.branchHead(), foreignSha);
});

test("rejects an unregistered matching worktree before writing the initial ledger record", async () => {
  const startSha = "a".repeat(40);
  const request = { repositoryPath: "/repository", commonDirectory: "/repository/.git", deliveryId: "d-1", branch: "shipyard/d-1", worktreePath: "/worktrees/d-1", initialLedgerPath: "deliveries/d-1.json", initialLedgerContents: JSON.stringify({ deliveryId: "d-1" }) };
  let registryWrites = 0; let ensureCalls = 0;
  const records: Record<string, string> = {};
  const registry = { async lockScope() { return { path: "/state/deliveries.json.lock", scope: "/state/deliveries.json" }; }, async read() { return undefined; }, async write() { registryWrites += 1; } };
  const ledger = {
    async snapshot(paths: readonly string[]) { return { head: records[request.initialLedgerPath] ? "ledger" : undefined, records: Object.fromEntries(paths.flatMap((path) => records[path] === undefined ? [] : [[path, records[path]]])) }; },
    async transact(transaction: { writes: readonly { path: string; contents: string }[] }) { for (const write of transaction.writes) records[write.path] = write.contents; return "ledger"; },
  };
  const git = {
    ...missingOwnershipMethods,
    async commonDirectory() { return request.commonDirectory; },
    // Even an indistinguishable same-branch/same-SHA worktree is not
    // attributable without a registry claim.
    async branchExists() { return false; }, async worktreeExists() { return true; },
    async worktreeIdentity() { assert.fail("create intent must not inspect then adopt an existing path"); },
    async productHead() { return startSha; }, async branchHead() { return startSha; },
    async createClaimedBranch() { return true; }, async branchCreationMatches() { return true; },
    async readinessProof() { return { exists: false } as const; }, async createReadinessProof() { return true; },
    async ensureWorktree() { ensureCalls += 1; return true; },
  };
  const service = new WorkspaceService(registry, ledger, git, new MutationLockService(new MemoryFilesystem(), new FakeProcess()));

  await assert.rejects(service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
  assert.equal(ensureCalls, 0);
  assert.equal(registryWrites, 0);
  assert.equal(records[request.initialLedgerPath], undefined);
});

test("rejects an unproven false worktree-creation result without adopting its path", async () => {
  const startSha = "a".repeat(40);
  const request = { repositoryPath: "/repository", commonDirectory: "/repository/.git", deliveryId: "d-1", branch: "shipyard/d-1", worktreePath: "/worktrees/d-1", initialLedgerPath: "deliveries/d-1.json", initialLedgerContents: JSON.stringify({ deliveryId: "d-1" }) };
  let registryWrites = 0;
  const records: Record<string, string> = {};
  const registry = { async lockScope() { return { path: "/state/deliveries.json.lock", scope: "/state/deliveries.json" }; }, async read() { return undefined; }, async write() { registryWrites += 1; } };
  const ledger = {
    async snapshot(paths: readonly string[]) { return { head: records[request.initialLedgerPath] ? "ledger" : undefined, records: Object.fromEntries(paths.flatMap((path) => records[path] === undefined ? [] : [[path, records[path]]])) }; },
    async transact(transaction: { writes: readonly { path: string; contents: string }[] }) { for (const write of transaction.writes) records[write.path] = write.contents; return "ledger"; },
  };
  const git = {
    ...missingOwnershipMethods,
    async commonDirectory() { return request.commonDirectory; }, async branchExists() { return false; }, async worktreeExists() { return false; },
    async worktreeIdentity() { assert.fail("an unproven creation result must not be inspected or adopted"); },
    async productHead() { return startSha; }, async branchHead() { return startSha; }, async ensureWorktree() { return false; },
    async createClaimedBranch() { return true; }, async branchCreationMatches() { return true; },
    async readinessProof() { return { exists: false } as const; }, async createReadinessProof() { return true; },
  };
  const service = new WorkspaceService(registry, ledger, git, new MutationLockService(new MemoryFilesystem(), new FakeProcess()));

  await assert.rejects(service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
  assert.equal(registryWrites, 1);
  assert.ok(records[request.initialLedgerPath]);
});

test("does not remove a swapped path when the branch changes after created-worktree identity verification", async () => {
  const startSha = "a".repeat(40); const changedSha = "b".repeat(40);
  const request = { repositoryPath: "/repository", commonDirectory: "/repository/.git", deliveryId: "d-1", branch: "shipyard/d-1", worktreePath: "/worktrees/d-1", initialLedgerPath: "deliveries/d-1.json", initialLedgerContents: JSON.stringify({ deliveryId: "d-1" }) };
  let registryWrites = 0; let branchExists = false; let createdPathExists = false; let foreignReplacementExists = false; let removalAttempts = 0; let ownership: WorkspaceProofRecord | undefined;
  const records: Record<string, string> = {};
  const registry = { async lockScope() { return { path: "/state/deliveries.json.lock", scope: "/state/deliveries.json" }; }, async read() { return undefined; }, async write() { registryWrites += 1; } };
  const ledger = {
    async snapshot(paths: readonly string[]) { return { head: records[request.initialLedgerPath] ? "ledger" : undefined, records: Object.fromEntries(paths.flatMap((path) => records[path] === undefined ? [] : [[path, records[path]]])) }; },
    async transact(transaction: { writes: readonly { path: string; contents: string }[] }) { for (const write of transaction.writes) records[write.path] = write.contents; return "ledger"; },
  };
  const git = {
    ...missingOwnershipMethods,
    async commonDirectory() { return request.commonDirectory; },
    async worktreeExists() { return createdPathExists || foreignReplacementExists; },
    async worktreeIdentity() { return createdPathExists ? { commonDirectory: request.commonDirectory, branch: request.branch } : undefined; },
    async branchExists() { return branchExists; }, async productHead() { return startSha; },
    async branchHead() {
      // The path is swapped after identity verification but before the old
      // implementation would have issued its path-based removal.
      createdPathExists = false; foreignReplacementExists = true;
      return changedSha;
    },
    async createClaimedBranch(_repositoryPath: string, _branch: string, _startSha: string, record: WorkspaceProofRecord) { branchExists = true; ownership = record; return true; },
    async ownershipProof() { return ownership ? { exists: true as const, record: ownership } : { exists: false as const }; },
    async readinessProof() { return { exists: false } as const; }, async createReadinessProof() { return true; },
    async ensureWorktree() { createdPathExists = true; return true; },
    async removeWorktree() { removalAttempts += 1; foreignReplacementExists = false; },
  };
  const service = new WorkspaceService(registry, ledger, git, new MutationLockService(new MemoryFilesystem(), new FakeProcess()));

  await assert.rejects(service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
  assert.equal(foreignReplacementExists, true);
  assert.equal(removalAttempts, 0);
  assert.equal(registryWrites, 1);
  assert.ok(records[request.initialLedgerPath]);
});

test("real Git same-SHA foreign branch race remains rejected on retry", async () => {
  const value = await fixture();
  try {
    const request = value.request("d-race"); let foreignHead = ""; let injected = false;
    const racingGit = {
      ...nodeWorkspaceGit,
      async createClaimedBranch(repositoryPath: string, branch: string, startSha: string, ownership: WorkspaceProofRecord) {
        if (!injected) {
          injected = true;
          foreignHead = startSha;
          await git(repositoryPath, ["branch", branch, foreignHead]);
        }
        return nodeWorkspaceGit.createClaimedBranch(repositoryPath, branch, startSha, ownership);
      },
    };
    const service = new WorkspaceService(value.registry, value.ledger, racingGit, new MutationLockService(nodeFilesystem, nodeProcess));
    await assert.rejects(service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
    assert.equal((await value.registry.read())?.workspaces.length ?? 0, 1);
    const claim = (await value.registry.read())!.workspaces[0];
    assert.deepEqual(await nodeWorkspaceGit.ownershipProof(value.repository, claim.creationToken), { exists: false });
    assert.equal(await nodeWorkspaceGit.worktreeExists(request.worktreePath), false);
    assert.equal(await nodeWorkspaceGit.branchHead(value.repository, request.branch), foreignHead);
    await assert.rejects(value.service.createOrResume(request), (error: unknown) => error instanceof WorkspaceError && error.code === "workspace-conflict");
    assert.equal(await nodeWorkspaceGit.worktreeExists(request.worktreePath), false);
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
