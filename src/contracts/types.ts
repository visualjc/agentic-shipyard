/** Version carried by all durable Shipyard documents. */
export const CONTRACT_VERSION = 1 as const;
export type ContractVersion = typeof CONTRACT_VERSION;

export type GitHubActor = { login: string };
export type RepositoryRef = { owner: string; name: string; remoteUrl: string; defaultBranch: string };

export type StagedPairTopology = {
  kind: "staged-pair";
  development: RepositoryRef;
  destination: RepositoryRef;
};

export type SingleRepositoryTopology = {
  kind: "single-repository";
  repository: RepositoryRef;
};

export type Topology = StagedPairTopology | SingleRepositoryTopology;

export type Profile = {
  schemaVersion: ContractVersion;
  name: string;
  actor: GitHubActor;
  topology: Topology;
  allowedOperations: readonly Operation[];
};

/** A binding belongs to the Git common directory, not a particular worktree. */
export type Binding = {
  schemaVersion: ContractVersion;
  profileName: string;
  commonDirectory: string;
  topology: Topology;
  boundAt: string;
};

export type PathOwner =
  | "product"
  | "development-record"
  | "development-generated"
  | "destination-only"
  | "context-overlay"
  | "scratch";

export type PathRule = { owner: PathOwner; pattern: string };
export type PathPolicy = { schemaVersion: ContractVersion; rules: readonly PathRule[] };

export const OPERATIONS = [
  "setup", "status", "help", "review", "sync", "promote", "finalize",
] as const;
export type Operation = (typeof OPERATIONS)[number];

export const DELIVERY_PHASES = [
  "unbound", "ready", "implementing", "awaiting-acceptance", "awaiting-review",
  "reviewed", "promoting", "awaiting-human-merge", "finalizing", "complete", "blocked",
] as const;
export type DeliveryPhase = (typeof DELIVERY_PHASES)[number];

export type LifecycleState = {
  schemaVersion: ContractVersion;
  deliveryId: string;
  phase: DeliveryPhase;
  productSha?: string;
  ledgerSha?: string;
  destinationSha?: string;
  updatedAt: string;
};
