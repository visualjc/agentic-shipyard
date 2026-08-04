import type { RepositoryRef } from "../contracts/types.js";
import type { GitObjectFormat } from "../ledger/types.js";
import type { GitTreeEntry, PayloadPlan } from "./types.js";

export type StagedPromotionObservation=Readonly<{
  objectFormat:GitObjectFormat;sourceSha:string;sourceTreeSha:string;sourceEntries:readonly GitTreeEntry[];
  destinationMainSha:string;destinationMainEntries:readonly GitTreeEntry[];
  destinationBranchHeadSha?:string;destinationBranchTreeSha?:string;destinationBranchEntries?:readonly GitTreeEntry[];
  recordedDestinationParentEntries?:readonly GitTreeEntry[];
}>;
export type StagedPublicationReceipt=Readonly<{sourceSha:string;destinationParentSha:string;destinationCommitSha:string;destinationTreeSha:string;remoteHeadSha:string}>;
export interface StagedPromotionSession {
  readonly observation:StagedPromotionObservation;
  publish(plan:PayloadPlan,request:Readonly<{deliveryId:string;revision:number;destinationBranch:string;expectedRemoteHead?:string}>):Promise<StagedPublicationReceipt>;
  release():Promise<void>;
}
export interface StagedPromotionGit {
  stage(request:Readonly<{repositoryPath:string;actorLogin:string;developmentBranch:string;expectedSourceSha:string;expectedPreviousSourceSha?:string;expectedDestinationParentSha?:string;sourceBaselineSha?:string;destination:RepositoryRef;destinationBranch:string}>):Promise<StagedPromotionSession>;
}
