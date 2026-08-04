import type { FilesystemAdapter } from "../adapters/filesystem.js";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";
import { DeliveryError } from "./errors.js";
import type { DeliveryRegistry, DeliveryRegistryDocument, DeliveryWorkspace } from "./types.js";

/** Filesystem-backed adapter for explicitly configured machine-local registry state. */
export class JsonDeliveryRegistry implements DeliveryRegistry {
  private readonly requestedPath: string;
  private authority?: Promise<string>;

  constructor(private readonly filesystem: FilesystemAdapter, path: string) {
    try { this.requestedPath = canonicalAbsolutePath(path); }
    catch { throw new DeliveryError("delivery-registry-invalid", "Delivery registry path must be a canonical absolute path."); }
  }

  async lockScope(): Promise<Readonly<{ path: string; scope: string }>> {
    const path = await this.registryPath();
    return { path: `${path}.lock`, scope: path };
  }

  async read(): Promise<DeliveryRegistryDocument | undefined> {
    const text = await this.filesystem.readText(await this.registryPath());
    if (text === undefined) return undefined;
    try { return validateDeliveryRegistryDocument(JSON.parse(text)); }
    catch (error: unknown) {
      if (error instanceof DeliveryError) throw error;
      throw invalidDocument();
    }
  }

  async write(document: DeliveryRegistryDocument): Promise<void> {
    try {
      const validated = validateDeliveryRegistryDocument(document)!;
      await this.filesystem.writeTextAtomic(await this.registryPath(), `${JSON.stringify(validated, null, 2)}\n`);
    } catch (error: unknown) {
      if (error instanceof DeliveryError) throw error;
      throw invalidDocument();
    }
  }

  /**
   * A registry file may be addressed through a symlinked state directory.
   * Resolve the file itself when it exists; otherwise bind the future file to
   * its existing physical parent so its data and lock always share authority.
   */
  private async resolveAuthority(): Promise<string> {
    try {
      const existing = await this.filesystem.realpath(this.requestedPath);
      if (existing !== undefined) return canonicalAbsolutePath(existing);
      // A dangling symlink must not be treated as an absent registry: its
      // target is ambiguous and replacing it would silently change authority.
      if (await this.filesystem.pathExists(this.requestedPath)) throw new Error();
      const parent = await this.filesystem.realpath(dirname(this.requestedPath));
      if (parent === undefined || !await this.filesystem.isDirectory(parent)) throw new Error();
      return canonicalAbsolutePath(join(parent, basename(this.requestedPath)));
    } catch {
      throw new DeliveryError("delivery-registry-invalid", "Delivery registry path must resolve to an existing physical file or parent directory.");
    }
  }

  private registryPath(): Promise<string> {
    this.authority ??= this.resolveAuthority();
    return this.authority;
  }
}

export function newDeliveryRegistryDocument(workspaces: DeliveryWorkspace[] = []): DeliveryRegistryDocument {
  return validateDeliveryRegistryDocument({ schemaVersion: 1, workspaces })!;
}

/** Validates untrusted registry-port output and returns an independent value snapshot. */
export function validateDeliveryRegistryDocument(value: unknown): DeliveryRegistryDocument | undefined {
  if (value === undefined) return undefined;
  try {
    if (!record(value) || !exactKeys(value, ["schemaVersion", "workspaces"]) || value.schemaVersion !== 1 || !Array.isArray(value.workspaces)) throw new Error();
    const workspaces = value.workspaces.map(validateWorkspace);
    if (new Set(workspaces.map((workspace) => workspace.deliveryId)).size !== workspaces.length) throw duplicate();
    if (new Set(workspaces.map((workspace) => workspace.worktreePath)).size !== workspaces.length) throw duplicate();
    return { schemaVersion: 1, workspaces };
  } catch (error: unknown) {
    if (error instanceof DeliveryError) throw error;
    throw invalidDocument();
  }
}

function validateWorkspace(value: unknown): DeliveryWorkspace {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "state", "creationToken", "deliveryId", "commonDirectory", "branch", "worktreePath"]) || value.schemaVersion !== 1 || (value.state !== "creating" && value.state !== "ready") || typeof value.creationToken !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.creationToken)) throw new Error();
  const deliveryId = stableDeliveryId(value.deliveryId);
  const commonDirectory = canonicalAbsolutePath(value.commonDirectory);
  const worktreePath = canonicalAbsolutePath(value.worktreePath);
  const branch = canonicalWorkspaceBranch(value.branch, deliveryId);
  if (commonDirectory === worktreePath) throw new Error();
  return {
    schemaVersion: 1,
    state: value.state,
    creationToken: value.creationToken,
    deliveryId,
    commonDirectory,
    branch,
    worktreePath,
  };
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)); }
function nonEmpty(value: unknown): string { if (typeof value !== "string" || value.trim() === "") throw new Error(); return value; }
/** Stable IDs are safe in branch names, ledger paths, and local registry keys. */
export function stableDeliveryId(value: unknown): string {
  const id = nonEmpty(value);
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) || id.includes("..")) throw new Error();
  return id;
}

/** Delivery branches are derived from their stable delivery ID, never caller-selected. */
export function canonicalWorkspaceBranch(value: unknown, deliveryId: string): string {
  const branch = nonEmpty(value);
  if (branch !== `shipyard/${deliveryId}`) throw new Error();
  return branch;
}

/** Persist only normalized absolute POSIX paths, preventing equivalent registry keys. */
export function canonicalAbsolutePath(value: unknown): string {
  const path = nonEmpty(value);
  if (!isAbsolute(path) || normalize(path) !== path || path === "/" || path.endsWith("/") || path.includes("\0")) throw new Error();
  return path;
}
function invalidDocument(): DeliveryError { return new DeliveryError("delivery-registry-invalid", "Delivery registry is not a valid canonical version 1 document."); }
function duplicate(): DeliveryError { return new DeliveryError("delivery-duplicate", "Delivery registry contains duplicate delivery IDs or linked worktree paths."); }
