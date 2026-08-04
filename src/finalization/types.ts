import type { DevelopmentRecordObservation } from "../promotion/provider.js";
export type DestinationMergePolicy="merge-commit"|"squash"|"rebase";
export type FinalizationIntent=Readonly<{
  schemaVersion:1;deliveryId:string;manifestDigest:string;actorLogin:string;mergePolicy:DestinationMergePolicy;
  finalDevelopmentSha:string;finalDestinationCommitSha:string;finalDestinationTreeSha:string;
  destinationMergeSha:string;destinationMainSha:string;developmentMainBeforeSha:string;
  reviewedTag:string;developmentRecords:DevelopmentRecordObservation;createdAt:string;
}>;
export type FinalizationReceipt=Readonly<{
  schemaVersion:1;deliveryId:string;manifestDigest:string;finalDevelopmentSha:string;destinationMainSha:string;
  destinationMergeSha:string;reviewedTag:string;developmentPullRequestState:"closed-unmerged";
  developmentIssueState:"closed";developmentBranchDeleted:true;destinationBranchDeleted:true;completedAt:string;
}>;
export type MergeObservation=Readonly<{
  destinationMainSha:string;developmentMainSha:string;destinationBranchSha?:string;developmentBranchSha?:string;
  mergeCommitSha:string;mergeCommitTreeSha:string;mergeParents:readonly string[];
  mergeCommitAncestorOfMain:boolean;finalDestinationCommitAncestorOfMerge:boolean;
}>;
export type FinalizationStatus=Readonly<{phase:"finalizing"|"complete";deliveryId:string;destinationMainSha:string;sealSha?:string;blockers:readonly Readonly<{code:string;message:string}>[];nextSafeAction:string}>;
