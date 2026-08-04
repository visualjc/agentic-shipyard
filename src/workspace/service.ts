import { execFile } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import { DeliveryError } from "../delivery/errors.js";
import { canonicalAbsolutePath, canonicalWorkspaceBranch, newDeliveryRegistryDocument, stableDeliveryId } from "../delivery/registry.js";
import type { DeliveryRegistry, DeliveryWorkspace } from "../delivery/types.js";
import { LedgerError } from "../ledger/errors.js";
import type { LedgerStore } from "../ledger/types.js";
import { MutationLockService } from "../locking/mutation-lock.js";
import { WorkspaceError } from "./errors.js";
import { canonicalGitExecutable, DEFAULT_NODE_GIT_EXECUTABLE, sanitizedGitEnvironment } from "../adapters/git-transport.js";

const execFileAsync = promisify(execFile);

export type CreateOrResumeDelivery = Readonly<{
  repositoryPath: string; commonDirectory: string; deliveryId: string; branch: string; worktreePath: string;
  initialLedgerPath: string; initialLedgerContents: string; authoritativeBranch?: string;
}>;
export interface WorkspaceGit {
  commonDirectory(repositoryPath: string): Promise<string>;
  worktreeExists(path: string): Promise<boolean>;
  worktreeIdentity(path: string): Promise<WorkspaceGitIdentity | undefined>;
  worktreeIsClean(path: string): Promise<boolean>;
  branchExists(repositoryPath: string, branch: string): Promise<boolean>;
  branchHead(repositoryPath: string, branch: string): Promise<string | undefined>;
  productHead(repositoryPath: string): Promise<string>;
  ensureWorktree(repositoryPath: string, branch: string, path: string, startSha: string): Promise<void>;
  removeWorktree(repositoryPath: string, path: string): Promise<void>;
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
    return this.withLock(actualCommonDirectory, async () => {
      const workspace: DeliveryWorkspace = { schemaVersion: 1, deliveryId: request.deliveryId, commonDirectory: actualCommonDirectory, branch: request.branch, worktreePath: request.worktreePath };
      const document = await this.registry.read();
      const matches = document?.workspaces.filter((candidate) => candidate.deliveryId === request.deliveryId || candidate.worktreePath === request.worktreePath) ?? [];
      if (matches.length > 1 || (matches.length === 1 && !sameWorkspace(matches[0], workspace))) throw new WorkspaceError("workspace-conflict", "Pre-existing workspace state conflicts with this delivery.");
      if (document && document.workspaces.some((candidate) => candidate.branch === request.branch && candidate.deliveryId !== request.deliveryId)) throw new WorkspaceError("workspace-conflict", "The feature branch is registered to another delivery.");

      const snapshot = await this.ledger.snapshot([request.initialLedgerPath]);
      const existing = snapshot.records[request.initialLedgerPath];
      // Registry is written last. A matching registry entry without its first
      // durable record therefore cannot be a recoverable interruption.
      if (matches.length === 1 && existing === undefined) throw new WorkspaceError("workspace-ledger-conflict", "The registry entry has no durable initial delivery record.");
      const branchExists = await this.git.branchExists(request.repositoryPath, request.branch);
      if (existing === undefined && branchExists) {
        throw new WorkspaceError("workspace-conflict", "The canonical feature branch already exists without durable delivery provenance.");
      }
      const startSha = await this.git.productHead(request.repositoryPath);
      const provenance = existing === undefined
        ? initialDeliveryRecord(request, actualCommonDirectory, startSha)
        : parseInitialDeliveryRecord(existing);
      if (!provenance || !sameProvenance(provenance, request, actualCommonDirectory)) {
        throw new WorkspaceError("workspace-ledger-conflict", "The durable initial ledger record conflicts with this delivery.");
      }
      // Without a registry entry, a branch/worktree can only be adopted if it
      // still points at the exact product object recorded before ledger write.
      if (matches.length === 0 && branchExists) {
        if (await this.git.branchHead(request.repositoryPath, request.branch) !== provenance.startProductSha) {
          throw new WorkspaceError("workspace-conflict", "The canonical feature branch does not match durable delivery provenance.");
        }
      }
      try {
        if (existing === undefined) await this.ledger.transact({ expectedHead: snapshot.head, writes: [{ path: request.initialLedgerPath, contents: JSON.stringify(provenance) }], message: `initialize ${request.deliveryId}` });
      } catch (error: unknown) {
        if (error instanceof LedgerError && error.code === "ledger-stale-head") throw new WorkspaceError("workspace-ledger-conflict", "Ledger advanced during creation; re-read and resume explicitly.");
        throw error;
      }
      await this.ensureExpectedWorktree(request, actualCommonDirectory, provenance.startProductSha);
      if (matches.length === 0) {
        try { await this.registry.write(newDeliveryRegistryDocument([...(document?.workspaces ?? []), workspace])); }
        catch (error: unknown) { if (error instanceof DeliveryError) throw new WorkspaceError("workspace-registry-invalid", error.message); throw error; }
      }
      return { ...workspace };
    });
  }

  /** Removes only machine-local/rebuildable state. Ledger history is intentionally untouched. */
  async cleanup(repositoryPath: string, deliveryId: string): Promise<void> {
    const actualCommonDirectory = await this.git.commonDirectory(repositoryPath);
    await this.withLock(actualCommonDirectory, async () => {
      const document = await this.registry.read();
      const workspace = document?.workspaces.find((candidate) => candidate.deliveryId === deliveryId);
      if (!document || !workspace) return;
      if (workspace.commonDirectory !== actualCommonDirectory) throw new WorkspaceError("workspace-identity-mismatch", "The registered workspace belongs to another Git common directory.");
      if (await this.git.worktreeExists(workspace.worktreePath)) {
        const identity = await this.git.worktreeIdentity(workspace.worktreePath);
        if (!identity || !sameIdentity(identity, workspace)) throw new WorkspaceError("workspace-identity-mismatch", "Refusing to clean a path that is not the registered linked worktree.");
        if (!await this.git.worktreeIsClean(workspace.worktreePath)) throw new WorkspaceError("workspace-dirty", "Refusing to remove a dirty linked worktree; hand off or clean it explicitly first.");
        await this.git.removeWorktree(repositoryPath, workspace.worktreePath);
      }
      await this.registry.write(newDeliveryRegistryDocument(document.workspaces.filter((candidate) => candidate.deliveryId !== deliveryId)));
    });
  }

  private async ensureExpectedWorktree(request: CreateOrResumeDelivery, commonDirectory: string, startSha: string): Promise<void> {
    const exists = await this.git.worktreeExists(request.worktreePath);
    let identity = exists ? await this.git.worktreeIdentity(request.worktreePath) : undefined;
    if (exists && (!identity || identity.commonDirectory !== commonDirectory || identity.branch !== request.branch)) {
      throw new WorkspaceError("workspace-identity-mismatch", "The requested worktree path exists but is not this delivery’s Git worktree.");
    }
    if (!exists) {
      await this.git.ensureWorktree(request.repositoryPath, request.branch, request.worktreePath, startSha);
      identity = await this.git.worktreeIdentity(request.worktreePath);
      if (!identity || identity.commonDirectory !== commonDirectory || identity.branch !== request.branch) {
        throw new WorkspaceError("workspace-identity-mismatch", "Git did not create the requested delivery worktree identity.");
      }
    }
  }

  private async withLock<T>(commonDirectory: string, operation: () => Promise<T>): Promise<T> {
    const lock = await this.locks.acquire(`${commonDirectory}/shipyard-workspace.lock`, commonDirectory, "workspace");
    try { return await operation(); }
    finally { await lock.release(); }
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
    if (!request.initialLedgerPath || request.initialLedgerPath !== `deliveries/${deliveryId}.json` || request.initialLedgerContents.length === 0) throw new Error();
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
  async worktreeIsClean(path) { return (await gitRequired(path, ["status", "--porcelain=v1"])) === ""; },
  async branchExists(repositoryPath, branch) { return (await git(repositoryPath, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])) !== undefined; },
  async branchHead(repositoryPath, branch) { return git(repositoryPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]); },
  async productHead(repositoryPath) { return gitRequired(repositoryPath, ["rev-parse", "--verify", "HEAD"]); },
  async ensureWorktree(repositoryPath, branch, path, startSha) {
    const exists = await workspaceGit.branchExists(repositoryPath, branch);
    await gitRequired(repositoryPath, exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, startSha]);
  },
  async removeWorktree(repositoryPath, path) { await gitRequired(repositoryPath, ["worktree", "remove", path]); },
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
/** Convenient default workspace adapter; Git lookup remains lazy. */
export const nodeWorkspaceGit = createNodeWorkspaceGit();
