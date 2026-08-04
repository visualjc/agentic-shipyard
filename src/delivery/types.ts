import type { Binding } from "../contracts/types.js";

/** Rebuildable, machine-local registration for one active delivery worktree. */
export type DeliveryWorkspace = {
  schemaVersion: 1;
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
