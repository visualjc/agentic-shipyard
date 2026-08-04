import type { RepositoryRef } from "../contracts/types.js";
import type { DestinationPullRequest, PromotionMapping } from "./types.js";

export type DevelopmentRecordObservation=Readonly<{
  issue:Readonly<{id:string;number:number;url:string;state:"open"|"closed"}>;
  pullRequest:Readonly<{id:string;number:number;url:string;state:"open"|"closed";merged:boolean;headRef:string;headSha:string}>;
}>;
export interface StagedProviderSession {
  reconcileDestinationPullRequest(request:Readonly<{deliveryId:string;branch:string;base:string;headSha:string;title:string;dossier:string;resumeNumber?:number}>):Promise<DestinationPullRequest>;
  updateDestinationDossier(request:Readonly<{pullRequest:DestinationPullRequest;headSha:string;dossier:string}>):Promise<DestinationPullRequest>;
  observeDestinationPullRequest(request:Readonly<{number:number;marker:string}>):Promise<DestinationPullRequest>;
  observeDevelopmentRecords(deliveryId:string):Promise<DevelopmentRecordObservation>;
  closeDevelopmentPullRequest(expected:DevelopmentRecordObservation["pullRequest"]):Promise<void>;
  closeDevelopmentIssue(expected:DevelopmentRecordObservation["issue"]):Promise<void>;
}
export interface StagedProviderAuthority {
  open(request:Readonly<{actorLogin:string;development:RepositoryRef;destination:RepositoryRef}>):Promise<StagedProviderSession>;
}
export function destinationMarker(deliveryId:string):string{return `<!-- shipyard-destination:${deliveryId} -->`;}
export function destinationDossier(deliveryId:string,mappings:readonly PromotionMapping[]):string{return [`# Reviewed Shipyard delivery`,``,`Delivery: \`${deliveryId}\``,``,...mappings.flatMap(mapping=>[`Revision ${mapping.revision}: reviewed product \`${mapping.developmentSha}\` → destination \`${mapping.destinationCommitSha}\``,`Acceptance/review receipt: \`${mapping.evidence.reviewResultDigest}\``]),``,`This is a normal destination-owned pull request. Human/team merge policy remains authoritative.`].join("\n");}
