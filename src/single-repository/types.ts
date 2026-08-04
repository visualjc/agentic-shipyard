import type { RepositoryRef } from "../contracts/types.js";
import type { PromotionEvidencePin } from "../promotion/types.js";
import type { DestinationMergePolicy, MergeObservation } from "../finalization/types.js";

export type SingleRepositoryPullRequest = Readonly<{
  id: string;
  number: number;
  url: string;
  deliveryMarker: string;
  repository: Readonly<{ owner: string; name: string }>;
  headRepository: Readonly<{ owner: string; name: string }>;
  baseRepository: Readonly<{ owner: string; name: string }>;
  headRef: string;
  baseRef: string;
  headSha: string;
  baseSha: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  isCrossRepository: false;
  dossierDigest?: string;
  mergeCommitSha?: string;
}>;

export type SingleRepositoryTrackedIssue = Readonly<{
  id: string;
  number: number;
  url: string;
  deliveryMarker: string;
  state: "open" | "closed";
}>;

export type SingleRepositoryCertification = Readonly<{
  revision: number;
  headSha: string;
  headTreeSha: string;
  baseSha: string;
  policyDigest: string;
  dossierDigest: string;
  evidence: PromotionEvidencePin;
  certifiedAt: string;
}>;

export type SingleRepositoryManifest = Readonly<{
  schemaVersion: 1;
  topology: "single-repository";
  deliveryId: string;
  actorLogin: string;
  repository: RepositoryRef;
  branch: string;
  /** Invocation-owned delivery workspace, pinned before the first durable certification write. */
  workspace: Readonly<{ creationToken: string; commonDirectory: string; worktreePath: string }>;
  pullRequest: SingleRepositoryPullRequest;
  trackedIssue?: SingleRepositoryTrackedIssue;
  certifications: readonly SingleRepositoryCertification[];
  phase: "certifying" | "awaiting-human-merge" | "finalizing" | "complete";
}>;

export type SingleRepositoryProductObservation = Readonly<{
  objectFormat: "sha1" | "sha256";
  branch: string;
  headSha: string;
  headTreeSha: string;
  /** Exact PR base used to compute this observation's change set. */
  baseSha: string;
  /** Canonical, sorted unique old and new names in the exact base..head diff. */
  touchedPaths: readonly string[];
  entries: readonly Readonly<{ path: string; mode: "100644" | "100755" | "120000" | "160000"; objectId: string }>[];
}>;

export interface SingleRepositoryProductAuthority {
  observe(request: Readonly<{ repositoryPath: string; branch: string; expectedHeadSha: string; expectedBaseSha: string }>): Promise<SingleRepositoryProductObservation>;
}

export type SingleRepositoryFinalizationIntent = Readonly<{
  schemaVersion: 1;
  deliveryId: string;
  manifestDigest: string;
  actorLogin: string;
  mergePolicy: DestinationMergePolicy;
  finalHeadSha: string;
  finalHeadTreeSha: string;
  mergeCommitSha: string;
  mainSha: string;
  localMainBeforeSha: string;
  reviewedTag: string;
  trackedIssue?: SingleRepositoryTrackedIssue;
  createdAt: string;
}>;

export type SingleRepositoryFinalizationReceipt = Readonly<{
  schemaVersion: 1;
  deliveryId: string;
  manifestDigest: string;
  finalHeadSha: string;
  mainSha: string;
  mergeCommitSha: string;
  reviewedTag: string;
  pullRequestState: "merged";
  trackedIssueState: "closed" | "not-owned";
  deliveryBranchDeleted: true;
  completedAt: string;
}>;

export interface SingleRepositoryFinalizationGitSession {
  readonly observation: MergeObservation;
  ensureReviewedTag(tag: string, targetSha: string, message: string): Promise<string>;
  synchronizeLocalMain(expectedBefore: string, targetSha: string): Promise<void>;
  deleteDeliveryBranch(branch: string, expectedSha: string): Promise<void>;
  /** Re-read only the scoped remote delivery ref; no local mutation. */
  observeDeliveryBranchSha(branch: string): Promise<string | undefined>;
  /** Re-read only the scoped remote default branch; no local mutation. */
  observeMainSha(): Promise<string>;
  publishLedger(exactSealSha: string): Promise<void>;
  release(): Promise<void>;
}
export interface SingleRepositoryRecoveryGitSession {
  deleteDeliveryBranch(branch: string, expectedSha: string): Promise<void>;
  observeDeliveryBranchSha(branch: string): Promise<string | undefined>;
  publishLedger(exactSealSha: string): Promise<void>;
  release(): Promise<void>;
}

export interface SingleRepositoryFinalizationGitAuthority {
  observeLedger(request: Readonly<{ actorLogin: string; repository: RepositoryRef }>): Promise<string | undefined>;
  /** Read-only post-cleanup proof; it never opens a mutating finalization session. */
  observeFinalizationStatus(request: Readonly<{ repositoryPath: string; actorLogin: string; repository: RepositoryRef; deliveryBranch: string; mergeCommitSha: string }>): Promise<Readonly<{ ledgerSha?: string; deliveryBranchSha?: string; mainSha: string; mergeReachableFromMain: boolean }>>;
  openRecovery(request: Readonly<{ repositoryPath: string; actorLogin: string; repository: RepositoryRef; deliveryBranch: string; expectedMergeSha: string; expectedFinalHeadSha: string }>): Promise<SingleRepositoryRecoveryGitSession>;
  open(request: Readonly<{
    repositoryPath: string;
    actorLogin: string;
    repository: RepositoryRef;
    deliveryBranch: string;
    expectedMergeSha: string;
    expectedFinalHeadSha: string;
  }>): Promise<SingleRepositoryFinalizationGitSession>;
}

export type SingleRepositoryStatus = Readonly<{
  phase: SingleRepositoryManifest["phase"];
  deliveryId: string;
  headSha: string;
  pullRequest: Readonly<{ number: number; url: string; state: SingleRepositoryPullRequest["state"]; draft: boolean }>;
  sealSha?: string;
  blockers: readonly Readonly<{ code: string; message: string }>[];
  nextSafeAction: string;
}>;
