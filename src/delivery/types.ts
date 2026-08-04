import type { Binding } from "../contracts/types.js";

/** Rebuildable, machine-local registration for one active delivery worktree. */
export type DeliveryWorkspace = {
  schemaVersion: 1;
  /** `creating` is a durable claim which may be resumed only by WorkspaceService. */
  state: "creating" | "ready";
  /** Opaque, non-secret key for immutable local ownership/readiness proof refs. */
  creationToken: string;
  deliveryId: string;
  /** Canonical Git common directory, shared by the main clone and linked worktrees. */
  commonDirectory: string;
  branch: string;
  worktreePath: string;
};

/** Versioned local registry. Durable delivery history belongs to the ledger, not this document. */
export type DeliveryRegistryDocument = {
  schemaVersion: 1;
  workspaces: DeliveryWorkspace[];
};

export interface DeliveryRegistry {
  /**
   * Canonical mutation authority for this registry's read-modify-write cycle.
   * The scope identifies the guarded registry state; path is its lock file.
   */
  lockScope(): Promise<Readonly<{ path: string; scope: string }>>;
  read(): Promise<DeliveryRegistryDocument | undefined>;
  write(document: DeliveryRegistryDocument): Promise<void>;
}

/** Read-only proof boundary used by core delivery resolution. */
export interface DeliveryReadinessVerifier {
  verifyReadyWorkspace(repositoryPath: string, workspace: DeliveryWorkspace): Promise<boolean>;
}

export type DeliveryResolutionRequest = {
  repositoryPath: string;
  /** Explicit selection is permitted from any bound worktree of the same repository. */
  deliveryId?: string;
};

/** A fresh, immutable resolution snapshot. It is not a lease or mutation authority. */
export type ResolvedDelivery = Readonly<{
  binding: Readonly<Binding>;
  workspace: Readonly<DeliveryWorkspace>;
}>;
