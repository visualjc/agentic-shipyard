import type { AcceptanceEvidence, EvidenceDecision, EvidenceManifest, FindingResolution, ReviewRequest, ReviewResult } from "../evidence/types.js";
import { evaluateFreshness } from "../evidence/freshness.js";
import { evidencePath, persistEvidence } from "./ledger.js";
import type { LedgerStore } from "../ledger/types.js";
import type { ProductShaReader, ContextEnvelope, PinnedLedgerReader } from "../context/types.js";
import { canonicalJson, validateReviewResult } from "../evidence/schema.js";
import { TrustedReviewDispatcher } from "../review/dispatch.js";
export function acceptanceDecision(currentProductSha:string, manifest:EvidenceManifest, acceptance?:AcceptanceEvidence, request?:ReviewRequest, result?:ReviewResult, resolutions?:readonly FindingResolution[], priorResults?:readonly ReviewResult[]): EvidenceDecision { return evaluateFreshness({currentProductSha,manifest,acceptance,request,result,resolutions,priorResults}); }
/** Resolves every evidence citation from one exact reachable ledger commit. */
export async function resolvePinnedEvidenceRefs(ledger:PinnedLedgerReader,ledgerSha:string,refs:readonly string[]):Promise<readonly string[]>{const unique=[...new Set(refs)].sort();if(unique.length!==refs.length||unique.some(x=>!x||x.startsWith("/")||x.includes("\\")||x.split("/").some(p=>p===""||p==="."||p==="..")))throw new Error("Evidence references must be unique safe relative ledger paths.");const records=await ledger.read(ledgerSha,unique);if(unique.some(path=>typeof records[path]!=="string"))throw new Error("Pinned ledger does not resolve every evidence reference.");return Object.freeze(unique);}
/** Promotion authority: cited evidence must resolve at the exact ledger pin before evaluation. */
export async function evaluatePinnedEvidenceGate(input:Readonly<{ledger:PinnedLedgerReader;ledgerSha:string;currentProductSha:string;manifest:EvidenceManifest;acceptance:AcceptanceEvidence;request:ReviewRequest;result:ReviewResult;resolutions?:readonly FindingResolution[];priorResults?:readonly ReviewResult[]}>):Promise<EvidenceDecision>{const refs=[...input.acceptance.items.flatMap(x=>x.evidenceRefs),...input.request.intentRefs,...input.request.evidenceRefs,...input.result.findings.flatMap(x=>x.evidenceRefs),...(input.resolutions??[]).flatMap(x=>x.evidenceRefs),...(input.priorResults??[]).flatMap(x=>x.findings.flatMap(f=>f.evidenceRefs))];const declared=await resolvePinnedEvidenceRefs(input.ledger,input.ledgerSha,[...new Set(refs)]);return evaluateFreshness({currentProductSha:input.currentProductSha,manifest:input.manifest,acceptance:input.acceptance,request:input.request,result:input.result,...((input.resolutions)?{resolutions:input.resolutions}:{}),...((input.priorResults)?{priorResults:input.priorResults}:{}),declaredEvidenceRefs:declared});}
export class AcceptanceReviewService {
  constructor(private readonly products:ProductShaReader,private readonly ledger:LedgerStore & PinnedLedgerReader,private readonly reviews:TrustedReviewDispatcher) {}
  async dispatchAndPersist(input:Readonly<{repoRoot:string;deliveryId:string;envelope:ContextEnvelope;requestPath:string;request:ReviewRequest}>):Promise<ReviewResult>{
    const before=await this.products.currentProductSha(input.repoRoot); if(before!==input.request.productSha)throw new Error("Product SHA changed before review dispatch.");
    const requestName=`review-request-${input.request.reviewId}.json`,resultName=`review-result-${input.request.reviewId}.json`,requestPath=evidencePath(input.deliveryId,requestName),resultPath=evidencePath(input.deliveryId,resultName),requestBytes=canonicalJson(input.request);
    const existing=await this.ledger.snapshot([requestPath,resultPath]);
    if(existing.records[requestPath]!==undefined&&existing.records[requestPath]!==requestBytes)throw new Error("Immutable review request conflicts with the sealed request.");
    if(existing.records[resultPath]!==undefined){if(!existing.head||existing.records[requestPath]!==requestBytes)throw new Error("Completed review is missing its exact request.");const pinned=await this.ledger.read(existing.head,[requestPath,resultPath]);if(pinned[requestPath]!==requestBytes||pinned[resultPath]!==existing.records[resultPath])throw new Error("Pinned completed review is missing or tampered.");let resumed:ReviewResult;try{resumed=validateReviewResult(JSON.parse(pinned[resultPath]!));}catch{throw new Error("Pinned completed review is invalid.");}if(resumed.reviewId!==input.request.reviewId||resumed.productSha!==before)throw new Error("Pinned completed review does not match the sealed request.");if(await this.products.currentProductSha(input.repoRoot)!==before)throw new Error("Product SHA changed during completed-review resume.");return resumed;}
    const requestLedgerSha=await persistEvidence(this.ledger,input.deliveryId,requestName,input.request);
    const pinnedRequest=await this.ledger.read(requestLedgerSha,[requestPath]); if(pinnedRequest[requestPath]!==canonicalJson(input.request))throw new Error("Pinned review request is missing or tampered.");
    const afterWrite=await this.products.currentProductSha(input.repoRoot); if(afterWrite!==before)throw new Error("Product SHA changed after request persistence; review was not dispatched.");
    const result=(await this.reviews.dispatch(input.envelope,input.requestPath,input.request)).result;
    if(result.reviewId!==input.request.reviewId||result.productSha!==input.request.productSha)throw new Error("Reviewer result does not match the sealed request.");
    const afterReview=await this.products.currentProductSha(input.repoRoot); if(afterReview!==before)throw new Error("Product SHA changed during review; result was not persisted.");
    const resultLedgerSha=await persistEvidence(this.ledger,input.deliveryId,resultName,result);
    const records=await this.ledger.read(resultLedgerSha,[requestPath,resultPath]);
    if(records[requestPath]!==canonicalJson(input.request)||records[resultPath]!==canonicalJson(result)) throw new Error("Pinned review records are missing or tampered.");
    if(await this.products.currentProductSha(input.repoRoot)!==before)throw new Error("Product SHA changed after result persistence.");
    return result;
  }
}
