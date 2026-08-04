import type { GitObjectFormat } from "../ledger/types.js";

export type SyncRequest = Readonly<{ repositoryPath: string; sourceRef?: string }>;
export type SourceProvenance = Readonly<{
  schemaVersion: 1;
  remoteName: string;
  remoteUrl: string;
  requestedRef: string;
  localRef: string;
  sha: string;
  objectFormat: GitObjectFormat;
  observedAt: string;
  ledgerCheckpointSha: string;
}>;
export type SyncOutcome = Readonly<
  | { kind: "baseline"; destinationSha: string; nextSafeAction: string }
  | { kind: "source"; provenance: SourceProvenance; nextSafeAction: string }
>;
