import type { RepositoryRef } from "../contracts/types.js";
import type { MergeObservation } from "./types.js";
export interface FinalizationGitSession {
  readonly observation:MergeObservation;
  ensureReviewedTag(tag:string,targetSha:string,message:string):Promise<string>;
  synchronizeDevelopmentMain(expectedBefore:string,targetSha:string):Promise<void>;
  deleteDevelopmentBranch(branch:string,expectedSha:string):Promise<void>;
  deleteDestinationBranch(branch:string,expectedSha:string):Promise<void>;
  publishLedger(exactSealSha:string):Promise<void>;
  release():Promise<void>;
}
export interface FinalizationGitAuthority {open(request:Readonly<{repositoryPath:string;actorLogin:string;development:RepositoryRef;destination:RepositoryRef;developmentBranch:string;destinationBranch:string;expectedMergeSha:string;expectedFinalDevelopmentSha:string;expectedFinalDestinationSha:string}>):Promise<FinalizationGitSession>;}
export interface OwnedWorkspaceCleanup {removeOwned(request:Readonly<{repositoryPath:string;deliveryId:string;expectedBranch:string;expectedSha:string;expectedCreationToken?:string;expectedWorktreePath?:string}>):Promise<void>;}
