import type { PathOwner, RepositoryRef } from "../contracts/types.js";
import type { TrustedAcceptanceReceipt } from "../acceptance/gate.js";

export type GitTreeMode = "100644" | "100755" | "120000" | "160000";
export type GitTreeEntry = Readonly<{ path: string; mode: GitTreeMode; objectId: string }>;
export type ClassifiedTreeEntry = GitTreeEntry & Readonly<{ owner: PathOwner; source: "development" | "destination" }>;

export type PayloadPlan = Readonly<{
  sourceSha: string;
  parentDestinationSha: string;
  productEntries: readonly GitTreeEntry[];
  preservedDestinationEntries: readonly GitTreeEntry[];
  removedProductPaths: readonly string[];
  classifications: readonly ClassifiedTreeEntry[];
  policyDigest: string;
  projectionDigest: string;
}>;

export type PromotionEvidencePin = Readonly<{
  productSha: string; ledgerSha: string; manifestDigest: string; acceptanceDigest: string;
  reviewId: string; reviewRequestDigest: string; reviewResultDigest: string;
  reviewedLedgerSha: string; reviewerBundleDigest: string; evaluatedAt: string;
}>;

export type PromotionMapping = Readonly<{
  revision: number;
  developmentSha: string;
  destinationParentSha: string;
  destinationCommitSha: string;
  destinationTreeSha: string;
  projectedProductTreeSha: string;
  policyDigest: string;
  projectionDigest: string;
  evidence: PromotionEvidencePin;
  promotedAt: string;
}>;

export type DestinationPullRequest = Readonly<{
  id: string; number: number; url: string; marker: string;
  repository: Readonly<{ owner: string; name: string }>;
  headRepository: Readonly<{ owner: string; name: string }>;
  baseRepository: Readonly<{ owner: string; name: string }>;
  headRef: string; baseRef: string; headSha: string;
  state: "open" | "closed" | "merged";
  isCrossRepository: false;
  mergeCommitSha?: string;
}>;

export type PromotionManifest = Readonly<{
  schemaVersion: 1;
  deliveryId: string;
  actorLogin: string;
  development: Readonly<{ repository: RepositoryRef; branch: string }>;
  destination: Readonly<{ repository: RepositoryRef; branch: string; baselineSha: string }>;
  mappings: readonly PromotionMapping[];
  pullRequest?: DestinationPullRequest;
  phase: "promoting" | "awaiting-human-merge" | "finalizing" | "complete";
}>;

export type PromotionJournalStep =
  | "destination-branch-published" | "destination-pr-created" | "destination-pr-updated"
  | "final-intent-recorded" | "reviewed-tag-published" | "development-main-synchronized"
  | "development-pr-closed" | "development-issue-closed" | "development-branch-deleted"
  | "development-branch-delete-started" | "destination-branch-delete-started"
  | "destination-branch-deleted" | "final-receipt-recorded";

export type PromotionJournalEntry = Readonly<{
  sequence: number; step: PromotionJournalStep; idempotencyKey: string;
  observedSha?: string; providerId?: string; completedAt: string;
}>;
export type PromotionJournal = Readonly<{ schemaVersion: 1; deliveryId: string; entries: readonly PromotionJournalEntry[] }>;

export type PromotionStatus = Readonly<{
  phase: PromotionManifest["phase"];
  deliveryId: string;
  developmentSha: string;
  destinationSha: string;
  destinationBranch: string;
  destinationPullRequest?: Readonly<{ number: number; url: string; state: DestinationPullRequest["state"] }>;
  blockers: readonly Readonly<{ code: string; message: string }>[];
  nextSafeAction: string;
}>;

export function evidencePin(receipt: TrustedAcceptanceReceipt): PromotionEvidencePin {
  return Object.freeze({productSha:receipt.productSha,ledgerSha:receipt.ledgerSha,manifestDigest:receipt.manifestDigest,acceptanceDigest:receipt.acceptanceDigest,reviewId:receipt.reviewId,reviewRequestDigest:receipt.reviewRequestDigest,reviewResultDigest:receipt.reviewResultDigest,reviewedLedgerSha:receipt.reviewedLedgerSha,reviewerBundleDigest:receipt.reviewerBundleDigest,evaluatedAt:receipt.evaluatedAt});
}
