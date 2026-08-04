/** Version carried by all durable Shipyard documents. */
export const CONTRACT_VERSION = 1 as const;
export type ContractVersion = typeof CONTRACT_VERSION;

export type GitHubActor = { login: string };
/** A named remote is part of repository identity; URL-only matching is unsafe. */
export type RemoteExpectation = { name: string; url: string };
export type RepositoryRef = { owner: string; name: string; remote: RemoteExpectation; defaultBranch: string };

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
  /** This profile owns the only path-authority policy Shipyard may use. */
  pathPolicy: PathPolicy;
  /** Omission is the backward-compatible, disabled graph configuration. */
  graph?: GraphProfile;
};

export type GraphProfile =
  | Readonly<{ enabled: false }>
  | Readonly<{ enabled: true; localOnlyApproved: true; adapter: "graphify"; reviewedToolSource: "graphify@0.9.32#00efd6e7969837ae4a9f11d8d504dcd3b20b09df"; executablePath: string; cacheRoot: string }>
  | Readonly<{ enabled: true; localOnlyApproved: true; adapter: "codegraph"; reviewedToolSource: "codegraph@1.5.0#49c11fc2e0c02170742be8411e66a31af611f4b7"; executablePath: string; nodeExecutablePath: string }>;

/** A binding belongs to the Git common directory, not a particular worktree. */
export type Binding = {
  schemaVersion: ContractVersion;
  profileName: string;
  commonDirectory: string;
  topology: Topology;
  /** SHA-256 of the canonical, fully validated profile (see profile/fingerprint). */
  profileFingerprint: string;
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
