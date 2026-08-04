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

/** Narrow mutable Git seam. Implementations must never rebase, reset, merge, or push. */
export interface SyncGit {
  observe(repositoryPath: string, destinationRemote: string, developmentBranch: string, destinationBranch: string): Promise<BaselineObservation>;
  observeStaged(repositoryPath: string, stagedRepositoryPath: string, destinationRemote: string, developmentBranch: string): Promise<BaselineObservation>;
  materializeStaged(repositoryPath: string, stagedRepositoryPath: string, stagedRef: string, expectedSha: string): Promise<void>;
  fastForward(repositoryPath: string, destinationRemote: string, developmentBranch: string, destinationBranch: string, expectedDevelopmentSha: string, expectedDestinationSha: string): Promise<void>;
  importStaged(repositoryPath: string, stagedRepositoryPath: string, stagedRef: string, localRef: string, expectedSha: string): Promise<string>;
  importSource(repositoryPath: string, destinationRemote: string, sourceRef: string, localRef: string): Promise<string>;
  resolveSource(repositoryPath: string, destinationRemote: string, sourceRef: string): Promise<string>;
  resolveLocal(repositoryPath: string, localRef: string): Promise<string>;
  resolveLocalOptional(repositoryPath: string, localRef: string): Promise<string | undefined>;
}
