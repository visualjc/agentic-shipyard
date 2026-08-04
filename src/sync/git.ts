import type { GitObjectFormat } from "../ledger/types.js";

/** Facts observed from local Git; none may be inferred from a ref name. */
export type BaselineObservation = Readonly<{
  clean: boolean;
  checkedOutBranch: string;
  developmentSha: string;
  destinationSha: string;
  ancestry: "equal" | "behind" | "ahead" | "diverged";
  remoteUrl: string | undefined;
  changedPaths: readonly string[];
  objectFormat: GitObjectFormat;
}>;

/** Exact local facts that must still hold at the last-moment mutation seam. */
export type SyncMutationProof = Readonly<{
  destinationRemote: string;
  developmentBranch: string;
  destinationBranch: string;
  expectedDevelopmentSha: string;
  expectedDestinationTrackingSha: string;
  expectedRemoteUrl: string;
  objectFormat: GitObjectFormat;
}>;

/** Owner-compatible #5 seam used only while a caller already holds the shared repository mutation lock. */
export type UnderLockMainFastForwardProof = Readonly<{
  developmentBranch:string;expectedDevelopmentSha:string;targetDestinationSha:string;objectFormat:GitObjectFormat;
}>;
export interface UnderLockMainSyncGit { fastForwardMainUnderLock(repositoryPath:string,proof:UnderLockMainFastForwardProof):Promise<void>; }

/** Narrow mutable Git seam. Implementations must never rebase, reset, merge, or push. */
export interface SyncGit {
  observe(repositoryPath: string, destinationRemote: string, developmentBranch: string, destinationBranch: string): Promise<BaselineObservation>;
  observeStaged(repositoryPath: string, stagedRepositoryPath: string, destinationRemote: string, developmentBranch: string): Promise<BaselineObservation>;
  materializeStaged(repositoryPath: string, stagedRepositoryPath: string, stagedRef: string, expectedSha: string, proof: SyncMutationProof): Promise<void>;
  fastForward(repositoryPath: string, expectedDestinationSha: string, proof: SyncMutationProof): Promise<void>;
  importStaged(repositoryPath: string, stagedRepositoryPath: string, stagedRef: string, localRef: string, expectedSha: string, proof: SyncMutationProof): Promise<string>;
  resolveSource(repositoryPath: string, destinationRemote: string, sourceRef: string): Promise<string>;
  resolveLocal(repositoryPath: string, localRef: string): Promise<string>;
  resolveLocalOptional(repositoryPath: string, localRef: string): Promise<string | undefined>;
}
