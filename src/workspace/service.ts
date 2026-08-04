import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import { DeliveryError } from "../delivery/errors.js";
import { canonicalAbsolutePath, canonicalWorkspaceBranch, newDeliveryRegistryDocument, stableDeliveryId } from "../delivery/registry.js";
import type { DeliveryReadinessVerifier, DeliveryRegistry, DeliveryWorkspace } from "../delivery/types.js";
import { LedgerError } from "../ledger/errors.js";
import type { LedgerStore } from "../ledger/types.js";
import { MutationLockService } from "../locking/mutation-lock.js";
import { WorkspaceError } from "./errors.js";
import { createWorkspaceProofRecord, parseWorkspaceProofRecord, proofMatchesWorkspace, serializeWorkspaceProofRecord, workspaceProofRef } from "./proof.js";
import type { WorkspaceProofObservation, WorkspaceProofRecord } from "./proof.js";
import { canonicalGitExecutable, DEFAULT_NODE_GIT_EXECUTABLE, sanitizedGitEnvironment } from "../adapters/git-transport.js";

const execFileAsync = promisify(execFile);

export type CreateOrResumeDelivery = Readonly<{
  repositoryPath: string; commonDirectory: string; deliveryId: string; branch: string; worktreePath: string;
  initialLedgerPath: string; initialLedgerContents: string; authoritativeBranch?: string;
}>;
/** The branch decision captured while the workspace lock is held. */
export type WorktreeEnsureIntent = Readonly<
  | { mode: "create"; startSha: string }
  | { mode: "attach" }
>;
export interface WorkspaceGit extends DeliveryReadinessVerifier {
  commonDirectory(repositoryPath: string): Promise<string>;
  worktreeExists(path: string): Promise<boolean>;
  worktreeIdentity(path: string): Promise<WorkspaceGitIdentity | undefined>;
  branchExists(repositoryPath: string, branch: string): Promise<boolean>;
  branchHead(repositoryPath: string, branch: string): Promise<string | undefined>;
  /** Atomically creates both the branch and its immutable ownership-proof ref. */
  createClaimedBranch(repositoryPath: string, branch: string, startSha: string, ownership: WorkspaceProofRecord): Promise<boolean>;
  ownershipProof(repositoryPath: string, token: string): Promise<WorkspaceProofObservation>;
  readinessProof(repositoryPath: string, token: string): Promise<WorkspaceProofObservation>;
  /** Atomically verifies branch and ownership refs, then creates readiness. */
  createReadinessProof(repositoryPath: string, branch: string, startSha: string, ownership: WorkspaceProofRecord, readiness: WorkspaceProofRecord): Promise<boolean>;
  productHead(repositoryPath: string): Promise<string>;
  /** True only when this invocation successfully created the linked worktree. */
  ensureWorktree(repositoryPath: string, branch: string, path: string, intent: WorktreeEnsureIntent): Promise<boolean>;
}
export type WorkspaceGitIdentity = Readonly<{ commonDirectory: string; branch: string }>;
export type InitialDeliveryLedgerRecord = Readonly<{
  schemaVersion: 1;
  deliveryId: string;
  commonDirectory: string;
  branch: string;
  startProductSha: string;
  payload: string;
}>;

/** Coordinates rebuildable registration and worktree state with a durable, isolated ledger record. */
export class WorkspaceService {
  constructor(
    private readonly registry: DeliveryRegistry,
    private readonly ledger: LedgerStore,
    private readonly git: WorkspaceGit,
    /** Required: registry read-modify-write is always serialized by the durable lock service. */
    private readonly locks: MutationLockService,
  ) {}

  async createOrResume(request: CreateOrResumeDelivery): Promise<DeliveryWorkspace> {
    validateRequest(request);
    if (request.branch === (request.authoritativeBranch ?? "main")) {
      throw new WorkspaceError("workspace-authoritative-main", "Delivery work cannot start directly on the authoritative main branch.");
    }
    const actualCommonDirectory = await this.git.commonDirectory(request.repositoryPath);
    if (actualCommonDirectory !== request.commonDirectory) throw new WorkspaceError("workspace-identity-mismatch", "The requested common directory does not match the repository Git identity.");
    return this.withLocks(actualCommonDirectory, async () => {
      const readyWorkspace: DeliveryWorkspace = { schemaVersion: 1, state: "ready", creationToken: randomUUID(), deliveryId: request.deliveryId, commonDirectory: actualCommonDirectory, branch: request.branch, worktreePath: request.worktreePath };
      const creatingWorkspace: DeliveryWorkspace = { ...readyWorkspace, state: "creating" };
      const document = await this.registry.read();
      const matches = document?.workspaces.filter((candidate) => candidate.deliveryId === request.deliveryId || candidate.worktreePath === request.worktreePath) ?? [];
      if (matches.length > 1 || (matches.length === 1 && !sameWorkspace(matches[0], readyWorkspace))) throw new WorkspaceError("workspace-conflict", "Pre-existing workspace state conflicts with this delivery.");
      if (document && document.workspaces.some((candidate) => candidate.branch === request.branch && candidate.deliveryId !== request.deliveryId)) throw new WorkspaceError("workspace-conflict", "The feature branch is registered to another delivery.");

      const snapshot = await this.ledger.snapshot([request.initialLedgerPath]);
      const existing = snapshot.records[request.initialLedgerPath];
      // The ledger precedes the claim. A claim without it is never recoverable.
      if (matches.length === 1 && existing === undefined) throw new WorkspaceError("workspace-ledger-conflict", "The registry entry has no durable initial delivery record.");
      const branchExists = await this.git.branchExists(request.repositoryPath, request.branch);
      const worktreeExists = await this.git.worktreeExists(request.worktreePath);
      // A registry entry is the sole authority for adopting an existing branch
      // or path. The ledger proves intent, but cannot attribute pre-existing
      // Git state to this invocation after an interrupted creation attempt.
      if (matches.length === 0 && (branchExists || worktreeExists)) {
        throw new WorkspaceError("workspace-conflict", "The canonical feature branch or worktree path already exists without a registry claim; inspect it manually before retrying.");
      }
      const startSha = await this.git.productHead(request.repositoryPath);
      const provenance = existing === undefined
        ? initialDeliveryRecord(request, actualCommonDirectory, startSha)
        : parseInitialDeliveryRecord(existing);
      if (!provenance || !sameProvenance(provenance, request, actualCommonDirectory)) {
        throw new WorkspaceError("workspace-ledger-conflict", "The durable initial ledger record conflicts with this delivery.");
      }
      try {
        if (existing === undefined) await this.ledger.transact({ expectedHead: snapshot.head, writes: [{ path: request.initialLedgerPath, contents: JSON.stringify(provenance) }], message: `initialize ${request.deliveryId}` });
      } catch (error: unknown) {
        if (error instanceof LedgerError && error.code === "ledger-stale-head") throw new WorkspaceError("workspace-ledger-conflict", "Ledger advanced during creation; re-read and resume explicitly.");
        throw error;
      }
      // Claim names before any Git mutation. This makes each interruption
      // after this point resumable, while a claim without its initial ledger
      // record remains invalid above.
      let claimed = matches[0];
      if (!claimed) {
        try {
          await this.registry.write(newDeliveryRegistryDocument([...(document?.workspaces ?? []), creatingWorkspace]));
          claimed = creatingWorkspace;
        } catch (error: unknown) { if (error instanceof DeliveryError) throw new WorkspaceError("workspace-registry-invalid", error.message); throw error; }
      }
      const claimedBranchExists = await this.git.branchExists(request.repositoryPath, request.branch);
      const ownershipRecord = createWorkspaceProofRecord("ownership", claimed, provenance.startProductSha);
      const readinessRecord = createWorkspaceProofRecord("readiness", claimed, provenance.startProductSha);
      let ownershipProof = await this.git.ownershipProof(request.repositoryPath, claimed.creationToken);
      let readinessProof = await this.git.readinessProof(request.repositoryPath, claimed.creationToken);
      assertProofNotForeign(ownershipProof, ownershipRecord, "ownership");
      assertProofNotForeign(readinessProof, readinessRecord, "readiness");
      if (claimed.state === "ready" && (!claimedBranchExists || !proofExactlyMatches(ownershipProof, ownershipRecord) || !proofExactlyMatches(readinessProof, readinessRecord))) {
        throw new WorkspaceError("workspace-conflict", "The ready delivery is missing its exact branch, ownership proof, or readiness proof.");
      }
      if (claimed.state === "creating") {
        if (proofExactlyMatches(readinessProof, readinessRecord)) {
          if (!proofExactlyMatches(ownershipProof, ownershipRecord) || !claimedBranchExists) {
            throw new WorkspaceError("workspace-conflict", "The readiness-proven delivery is missing its exact ownership proof or branch.");
          }
        } else if (proofExactlyMatches(ownershipProof, ownershipRecord)) {
          if (!claimedBranchExists || await this.git.branchHead(request.repositoryPath, request.branch) !== provenance.startProductSha) {
            throw new WorkspaceError("workspace-conflict", "The ownership-proven creating branch no longer matches its ledger start SHA.");
          }
        } else if (claimedBranchExists) {
          throw new WorkspaceError("workspace-conflict", "The creating branch exists without this claim's immutable ownership proof.");
        } else {
          if (!await this.git.createClaimedBranch(request.repositoryPath, request.branch, provenance.startProductSha, ownershipRecord)) {
            throw new WorkspaceError("workspace-conflict", "The canonical feature branch or ownership proof appeared during creation; refusing to adopt it.");
          }
          ownershipProof = await this.git.ownershipProof(request.repositoryPath, claimed.creationToken);
          if (!proofExactlyMatches(ownershipProof, ownershipRecord)) throw new WorkspaceError("workspace-conflict", "Git did not create the exact branch ownership proof.");
        }
        if (!await this.git.branchExists(request.repositoryPath, request.branch)) {
          throw new WorkspaceError("workspace-conflict", "The readiness-proven canonical feature branch is missing.");
        }
      }
      // This is deliberately decided here, under the workspace lock. The Git
      // adapter must not inspect the branch again and silently turn a create
      // into an attach after an external actor wins that race.
      const worktreeIntent: WorktreeEnsureIntent = { mode: "attach" };
      await this.ensureExpectedWorktree(request, actualCommonDirectory, worktreeIntent);
      if (claimed.state === "creating") {
        if (!proofExactlyMatches(readinessProof, readinessRecord)) {
          ownershipProof = await this.git.ownershipProof(request.repositoryPath, claimed.creationToken);
          if (!proofExactlyMatches(ownershipProof, ownershipRecord)) throw new WorkspaceError("workspace-conflict", "The exact ownership proof disappeared before readiness.");
          // This transaction is the readiness linearization point: Git creates
          // a canonical blob proof only if both the feature and ownership refs
          // still equal their expected immutable values.
          if (!await this.git.createReadinessProof(request.repositoryPath, request.branch, provenance.startProductSha, ownershipRecord, readinessRecord)) {
            throw new WorkspaceError("workspace-conflict", "The canonical feature branch or ownership proof changed before readiness could be proven.");
          }
        }
        ownershipProof = await this.git.ownershipProof(request.repositoryPath, claimed.creationToken);
        readinessProof = await this.git.readinessProof(request.repositoryPath, claimed.creationToken);
        if (!proofExactlyMatches(ownershipProof, ownershipRecord) || !proofExactlyMatches(readinessProof, readinessRecord)) throw new WorkspaceError("workspace-conflict", "Git did not retain the exact delivery ownership and readiness proofs.");
        try { await this.registry.write(newDeliveryRegistryDocument((document?.workspaces ?? []).filter((candidate) => candidate.deliveryId !== request.deliveryId).concat({ ...readyWorkspace, creationToken: claimed.creationToken }))); }
        catch (error: unknown) { if (error instanceof DeliveryError) throw new WorkspaceError("workspace-registry-invalid", error.message); throw error; }
      }
      return { ...readyWorkspace, creationToken: claimed.creationToken };
    });
  }

  /**
   * Removes registry state only after the registered branch and worktree are absent.
   * Git's path-based worktree removal cannot atomically bind a prior identity
   * check to the removal, so present Git state always requires manual handoff.
   * Ledger history is intentionally untouched.
   */
  async cleanup(repositoryPath: string, deliveryId: string): Promise<void> {
    const actualCommonDirectory = await this.git.commonDirectory(repositoryPath);
    await this.withLocks(actualCommonDirectory, async () => {
      const document = await this.registry.read();
      const workspace = document?.workspaces.find((candidate) => candidate.deliveryId === deliveryId);
      if (!document || !workspace) return;
      if (workspace.commonDirectory !== actualCommonDirectory) throw new WorkspaceError("workspace-identity-mismatch", "The registered workspace belongs to another Git common directory.");
      if (await this.git.worktreeExists(workspace.worktreePath) || await this.git.branchExists(repositoryPath, workspace.branch)) {
        throw new WorkspaceError("workspace-manual-cleanup", "The registered feature branch or worktree path still exists. Remove it manually after verifying its ownership, then rerun cleanup to remove only the registry state.");
      }
      await this.registry.write(newDeliveryRegistryDocument(document.workspaces.filter((candidate) => candidate.deliveryId !== deliveryId)));
    });
  }

  private async ensureExpectedWorktree(request: CreateOrResumeDelivery, commonDirectory: string, intent: WorktreeEnsureIntent): Promise<void> {
    const exists = await this.git.worktreeExists(request.worktreePath);
    // A create intent cannot adopt a path that appeared after the branch
    // preflight. Even matching branch/common-directory data cannot attribute
    // that worktree to this invocation.
    if (exists && intent.mode === "create") {
      throw new WorkspaceError("workspace-conflict", "The requested worktree path appeared during creation; refusing to adopt it.");
    }
    let identity = exists ? await this.git.worktreeIdentity(request.worktreePath) : undefined;
    if (exists && (!identity || identity.commonDirectory !== commonDirectory || identity.branch !== request.branch)) {
      throw new WorkspaceError("workspace-identity-mismatch", "The requested worktree path exists but is not this delivery’s Git worktree.");
    }
    if (exists && await this.git.branchHead(request.repositoryPath, request.branch) !== await this.git.productHead(request.worktreePath)) {
      throw new WorkspaceError("workspace-conflict", "The requested worktree and canonical feature branch no longer have the same head.");
    }
    if (!exists) {
      let created: boolean;
      try {
        created = await this.git.ensureWorktree(request.repositoryPath, request.branch, request.worktreePath, intent);
      } catch (error: unknown) {
        // A create-mode failure with the branch now present and no worktree at
        // our path is the external same-SHA race. Do not remove anything: Git
        // did not prove that path belongs to this invocation.
        if (intent.mode === "create" && await this.git.branchExists(request.repositoryPath, request.branch) && !await this.git.worktreeExists(request.worktreePath)) {
          throw new WorkspaceError("workspace-conflict", "The canonical feature branch appeared during worktree creation; refusing to adopt it.");
        }
        throw error;
      }
      if (!created) {
        throw new WorkspaceError("workspace-conflict", "Git did not confirm this invocation created the requested worktree; refusing to adopt it.");
      }
      identity = await this.git.worktreeIdentity(request.worktreePath);
      if (!identity || identity.commonDirectory !== commonDirectory || identity.branch !== request.branch) {
        throw new WorkspaceError("workspace-identity-mismatch", "Git did not create the requested delivery worktree identity.");
      }
      if (await this.git.branchHead(request.repositoryPath, request.branch) !== await this.git.productHead(request.worktreePath)) {
        throw new WorkspaceError("workspace-conflict", "The canonical feature branch changed during worktree creation; inspect the worktree manually before retrying.");
      }
    }
  }

  /**
   * The global nested-lock order is registry, then Git common-directory.
   * Tracking takes only the latter, so it cannot form an inverse lock cycle.
   */
  private async withLocks<T>(commonDirectory: string, operation: () => Promise<T>): Promise<T> {
    const registry = await this.registry.lockScope();
    const registryLock = await this.locks.acquire(registry.path, registry.scope, "workspace-registry");
    try {
      const workspaceLock = await this.locks.acquire(`${commonDirectory}/shipyard-workspace.lock`, commonDirectory, "workspace");
      try { return await operation(); }
      finally { await workspaceLock.release(); }
    } finally { await registryLock.release(); }
  }
}

function sameWorkspace(left: DeliveryWorkspace, right: DeliveryWorkspace): boolean {
  return left.deliveryId === right.deliveryId && left.commonDirectory === right.commonDirectory && left.branch === right.branch && left.worktreePath === right.worktreePath;
}
function sameIdentity(identity: WorkspaceGitIdentity, workspace: DeliveryWorkspace): boolean {
  return identity.commonDirectory === workspace.commonDirectory && identity.branch === workspace.branch;
}

function validateRequest(request: CreateOrResumeDelivery): void {
  try {
    const deliveryId = stableDeliveryId(request.deliveryId);
    canonicalWorkspaceBranch(request.branch, deliveryId);
    canonicalAbsolutePath(request.repositoryPath);
    canonicalAbsolutePath(request.commonDirectory);
    canonicalAbsolutePath(request.worktreePath);
    if (!request.initialLedgerPath || request.initialLedgerPath !== `deliveries/${deliveryId}.json` || typeof request.initialLedgerContents !== "string" || request.initialLedgerContents.length === 0) throw new Error();
    if (request.authoritativeBranch !== undefined && (!request.authoritativeBranch || request.authoritativeBranch.includes("..") || request.authoritativeBranch.startsWith("-") || /[\s~^:?*\\[\\]/.test(request.authoritativeBranch))) throw new Error();
  } catch { throw new WorkspaceError("workspace-invalid-input", "Workspace inputs must use canonical stable delivery IDs, branch names, paths, and ledger record paths."); }
}

/** Production Git worktree boundary; no remote or provider operation is available here. */
/**
 * Builds the local-only worktree adapter around an absolute Git executable.
 * It resolves that path on each operation rather than at module evaluation,
 * allowing package import and dependency construction on Git-less hosts.
 */
export function createNodeWorkspaceGit(executable = DEFAULT_NODE_GIT_EXECUTABLE): WorkspaceGit {
  const gitExecutable = (): string => canonicalGitExecutable(executable);
  const git = async (repositoryPath: string, args: string[]): Promise<string | undefined> => {
    try { const { stdout } = await execFileAsync(gitExecutable(), ["-C", repositoryPath, ...args], { encoding: "utf8", env: workspaceGitEnvironment() }); return stdout.trim(); }
    catch (error: unknown) { const code = (error as { code?: number }).code; if (code === 1) return undefined; throw error; }
  };
  const gitRequired = async (repositoryPath: string, args: string[]): Promise<string> => {
    const result = await git(repositoryPath, args);
    if (result === undefined) throw new Error(`Git worktree operation failed: ${args.join(" ")}`);
    return result;
  };
  const gitRawRequired = async (repositoryPath: string, args: string[]): Promise<string> => {
    try { return (await execFileAsync(gitExecutable(), ["-C", repositoryPath, ...args], { encoding: "utf8", env: workspaceGitEnvironment() })).stdout; }
    catch { throw new Error(`Git worktree operation failed: ${args.join(" ")}`); }
  };
  const readProof = async (repositoryPath: string, kind: "ownership" | "readiness", token: string): Promise<WorkspaceProofObservation> => {
    const ref = workspaceProofRef(kind, token);
    if (await git(repositoryPath, ["rev-parse", "--verify", "--quiet", ref]) === undefined) return { exists: false };
    if (await gitRequired(repositoryPath, ["cat-file", "-t", ref]) !== "blob") return { exists: true };
    const record = parseWorkspaceProofRecord(await gitRawRequired(repositoryPath, ["cat-file", "blob", ref]));
    return record ? { exists: true, record } : { exists: true };
  };
  const workspaceGit: WorkspaceGit = {
  async commonDirectory(repositoryPath) {
    const commonDirectory = await gitRequired(repositoryPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    return realpath(isAbsolute(commonDirectory) ? commonDirectory : resolve(repositoryPath, commonDirectory));
  },
  async worktreeExists(path) { try { await access(path); return true; } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } },
  async worktreeIdentity(path) {
    try {
      const commonDirectory = await workspaceGit.commonDirectory(path);
      const branch = await git(path, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      return branch === undefined ? undefined : { commonDirectory, branch };
    } catch { return undefined; }
  },
  async branchExists(repositoryPath, branch) { return (await git(repositoryPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])) !== undefined; },
  async branchHead(repositoryPath, branch) { return git(repositoryPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]); },
  async createClaimedBranch(repositoryPath, branch, startSha, ownership) {
    const ownershipBlob = await gitWithInputRequired(gitExecutable(), repositoryPath, ["hash-object", "-w", "--stdin"], serializeWorkspaceProofRecord(ownership));
    const transaction = `start\ncreate refs/heads/${branch} ${startSha}\ncreate ${workspaceProofRef("ownership", ownership.creationToken)} ${ownershipBlob}\nprepare\ncommit\n`;
    try { await gitWithInputRequired(gitExecutable(), repositoryPath, ["update-ref", "--stdin"], transaction); return true; }
    catch { return false; }
  },
  async ownershipProof(repositoryPath, token) { return readProof(repositoryPath, "ownership", token); },
  async readinessProof(repositoryPath, token) { return readProof(repositoryPath, "readiness", token); },
  async createReadinessProof(repositoryPath, branch, startSha, ownership, readiness) {
    const ownershipBlob = await gitWithInputRequired(gitExecutable(), repositoryPath, ["hash-object", "-w", "--stdin"], serializeWorkspaceProofRecord(ownership));
    const readinessBlob = await gitWithInputRequired(gitExecutable(), repositoryPath, ["hash-object", "-w", "--stdin"], serializeWorkspaceProofRecord(readiness));
    const transaction = `start\nverify refs/heads/${branch} ${startSha}\nverify ${workspaceProofRef("ownership", ownership.creationToken)} ${ownershipBlob}\ncreate ${workspaceProofRef("readiness", readiness.creationToken)} ${readinessBlob}\nprepare\ncommit\n`;
    try { await gitWithInputRequired(gitExecutable(), repositoryPath, ["update-ref", "--stdin"], transaction); return true; }
    catch { return false; }
  },
  async verifyReadyWorkspace(repositoryPath, workspace) {
    const ownership = await readProof(repositoryPath, "ownership", workspace.creationToken);
    const readiness = await readProof(repositoryPath, "readiness", workspace.creationToken);
    return ownership.exists && ownership.record !== undefined && readiness.exists && readiness.record !== undefined
      && proofMatchesWorkspace(ownership.record, "ownership", workspace)
      && proofMatchesWorkspace(readiness.record, "readiness", workspace)
      && ownership.record.startProductSha === readiness.record.startProductSha;
  },
  async productHead(repositoryPath) { return gitRequired(repositoryPath, ["rev-parse", "--verify", "HEAD"]); },
  async ensureWorktree(repositoryPath, branch, path, intent) {
    await gitRequired(repositoryPath, intent.mode === "attach"
      ? ["worktree", "add", path, branch]
      : ["worktree", "add", "-b", branch, path, intent.startSha]);
    return true;
  },
  };
  return workspaceGit;
}

function initialDeliveryRecord(request: CreateOrResumeDelivery, commonDirectory: string, startProductSha: string): InitialDeliveryLedgerRecord {
  return { schemaVersion: 1, deliveryId: request.deliveryId, commonDirectory, branch: request.branch, startProductSha, payload: request.initialLedgerContents };
}
function parseInitialDeliveryRecord(contents: string): InitialDeliveryLedgerRecord | undefined {
  try {
    const value: unknown = JSON.parse(contents);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 6 || record.schemaVersion !== 1 || !["deliveryId", "commonDirectory", "branch", "startProductSha", "payload"].every((key) => typeof record[key] === "string") || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(record.startProductSha as string)) return undefined;
    const result = record as unknown as InitialDeliveryLedgerRecord;
    return JSON.stringify(result) === contents ? result : undefined;
  } catch { return undefined; }
}
function sameProvenance(record: InitialDeliveryLedgerRecord, request: CreateOrResumeDelivery, commonDirectory: string): boolean {
  return record.deliveryId === request.deliveryId && record.commonDirectory === commonDirectory && record.branch === request.branch && record.payload === request.initialLedgerContents;
}
function workspaceGitEnvironment(): NodeJS.ProcessEnv {
  return sanitizedGitEnvironment();
}
function proofExactlyMatches(observation: WorkspaceProofObservation, expected: WorkspaceProofRecord): boolean {
  return observation.exists && observation.record !== undefined && serializeWorkspaceProofRecord(observation.record) === serializeWorkspaceProofRecord(expected);
}
function assertProofNotForeign(observation: WorkspaceProofObservation, expected: WorkspaceProofRecord, kind: "ownership" | "readiness"): void {
  if (observation.exists && !proofExactlyMatches(observation, expected)) throw new WorkspaceError("workspace-conflict", `The delivery ${kind} proof does not match this claim.`);
}
async function gitWithInputRequired(executable: string, repositoryPath: string, args: readonly string[], input: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, ["-C", repositoryPath, ...args], { env: workspaceGitEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolvePromise(stdout.trim()) : reject(new Error(`Git worktree operation failed with code ${code}: ${stderr.trim()}`)));
    child.stdin.end(input);
  });
}
/** Convenient default workspace adapter; Git lookup remains lazy. */
export const nodeWorkspaceGit = createNodeWorkspaceGit();
