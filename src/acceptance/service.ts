import type { AcceptanceEvidence, EvidenceDecision, EvidenceManifest, FindingResolution, ReviewRequest, ReviewResult } from "../evidence/types.js";
import { evaluateFreshness } from "../evidence/freshness.js";
import { evidencePath, persistEvidence } from "./ledger.js";
import type { LedgerStore } from "../ledger/types.js";
import type { ProductShaReader, ContextEnvelope, PinnedLedgerReader } from "../context/types.js";
import { canonicalJson, validateAcceptanceEvidence, validateFindingResolution, validateReviewRequest, validateReviewResult } from "../evidence/schema.js";
import { TrustedReviewDispatcher } from "../review/dispatch.js";
export function acceptanceDecision(currentProductSha:string, manifest:EvidenceManifest, acceptance?:AcceptanceEvidence, request?:ReviewRequest, result?:ReviewResult, resolutions?:readonly FindingResolution[], priorResults?:readonly ReviewResult[]): EvidenceDecision { return evaluateFreshness({currentProductSha,manifest,acceptance,request,result,resolutions,priorResults}); }
/** Resolves every evidence citation from one exact reachable ledger commit. */
export async function resolvePinnedEvidenceRefs(ledger:PinnedLedgerReader,ledgerSha:string,refs:readonly string[]):Promise<readonly string[]>{const unique=[...new Set(refs)].sort();if(unique.length!==refs.length||unique.some(x=>!x||x.startsWith("/")||x.includes("\\")||x.split("/").some(p=>p===""||p==="."||p==="..")))throw new Error("Evidence references must be unique safe relative ledger paths.");const records=await ledger.read(ledgerSha,unique);if(unique.some(path=>typeof records[path]!=="string"))throw new Error("Pinned ledger does not resolve every evidence reference.");return Object.freeze(unique);}
/** Promotion authority: evidence documents and every citation must resolve at one exact ledger pin. */
export async function evaluatePinnedEvidenceGate(raw:Readonly<{ledger:PinnedLedgerReader;ledgerSha:string;deliveryId:string;allowedEvidenceRefs:readonly string[];currentProductSha:string;manifest:EvidenceManifest;acceptance:AcceptanceEvidence;request:ReviewRequest;result:ReviewResult;resolutions?:readonly FindingResolution[];priorResults?:readonly ReviewResult[]}>):Promise<EvidenceDecision>{
  let input:typeof raw;
  try {
    const allowed=["ledger","ledgerSha","deliveryId","allowedEvidenceRefs","currentProductSha","manifest","acceptance","request","result","resolutions","priorResults"],keys=Reflect.ownKeys(raw);
    if(keys.some(k=>typeof k!=="string"||!allowed.includes(k)))throw new Error();
    const values:any={};for(const key of allowed){const descriptor=Object.getOwnPropertyDescriptor(raw,key);if(descriptor){if(!descriptor.enumerable||!("value" in descriptor))throw new Error();values[key]=descriptor.value;}}input=values;
  } catch { throw new Error("Pinned evidence gate input is invalid."); }
  if(!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(input.deliveryId))throw new Error("Pinned evidence gate delivery ID is invalid.");
  const acceptance=validateAcceptanceEvidence(input.acceptance),request=validateReviewRequest(input.request),result=validateReviewResult(input.result),resolutions=(input.resolutions??[]).map(validateFindingResolution),prior=(input.priorResults??[]).map(validateReviewResult);
  const refs=[...acceptance.items.flatMap(x=>x.evidenceRefs),...request.intentRefs,...request.evidenceRefs,...result.findings.flatMap(x=>x.evidenceRefs),...resolutions.flatMap(x=>x.evidenceRefs),...prior.flatMap(x=>x.findings.flatMap(f=>f.evidenceRefs))],allowed=new Set(input.allowedEvidenceRefs),deliveryPrefix=`deliveries/${input.deliveryId}/`;
  if(refs.some(ref=>!allowed.has(ref)||(ref.startsWith("deliveries/")&&!ref.startsWith(deliveryPrefix))))throw new Error("Evidence citation is outside the delivery's code-owned manifest.");
  const safeId=(id:string)=>{if(!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(id))throw new Error("Pinned evidence record ID is invalid.");return id;},prefix=`deliveries/${input.deliveryId}/evidence/`;
  const documents=new Map<string,string>([[`${prefix}acceptance.json`,canonicalJson(acceptance)],[`${prefix}review-request-${safeId(request.reviewId)}.json`,canonicalJson(request)],[`${prefix}review-result-${safeId(result.reviewId)}.json`,canonicalJson(result)]]);
  for(const review of prior){const path=`${prefix}review-result-${safeId(review.reviewId)}.json`;if(documents.has(path))throw new Error("Pinned review history contains duplicate records.");documents.set(path,canonicalJson(review));}
  for(const resolution of resolutions){const path=`${prefix}finding-resolution-${safeId(resolution.findingId)}.json`;if(documents.has(path))throw new Error("Pinned finding resolutions contain duplicate records.");documents.set(path,canonicalJson(resolution));}
  const pinnedDocuments=await input.ledger.read(input.ledgerSha,[...documents.keys()]);
  if([...documents].some(([path,bytes])=>pinnedDocuments[path]!==bytes))throw new Error("Pinned evidence documents are missing or do not match the exact ledger commit.");
  const declared=await resolvePinnedEvidenceRefs(input.ledger,input.ledgerSha,[...new Set(refs)]),advisory=evaluateFreshness({currentProductSha:input.currentProductSha,manifest:input.manifest,acceptance,request,result,...(resolutions.length?{resolutions}:{}),...(prior.length?{priorResults:prior}:{}),declaredEvidenceRefs:declared}),eligible=advisory.acceptanceFresh&&advisory.reviewFresh&&advisory.blockers.length===0&&advisory.blockingFindingIds.length===0;
  return Object.freeze({...advisory,promotionEligible:eligible,nextAction:eligible?"proceed-to-promotion-gate":advisory.nextAction});
}

export type ReviewLockIdentity=Readonly<{repository:string;deliveryId:string;reviewId:string}>;
/** One repository-shared lock must cover every preflight, spawn, and ledger mutation. */
export interface ReviewMutationLock { withReviewLock<T>(identity:ReviewLockIdentity,operation:()=>Promise<T>):Promise<T>; }
export class AcceptanceReviewService {
  constructor(private readonly products:ProductShaReader,private readonly ledger:LedgerStore & PinnedLedgerReader,private readonly reviews:TrustedReviewDispatcher,private readonly lock:ReviewMutationLock) {}
  async dispatchAndPersist(rawInput:Readonly<{repoRoot:string;deliveryId:string;envelope:ContextEnvelope;request:ReviewRequest}>):Promise<ReviewResult>{
    const input=JSON.parse(canonicalJson(rawInput)) as typeof rawInput;
    const identity=Object.freeze({repository:input.repoRoot,deliveryId:input.deliveryId,reviewId:input.request.reviewId});
    return this.lock.withReviewLock(identity,()=>this.dispatchAndPersistLocked(input));
  }
  private async dispatchAndPersistLocked(input:Readonly<{repoRoot:string;deliveryId:string;envelope:ContextEnvelope;request:ReviewRequest}>):Promise<ReviewResult>{
    const before=await this.products.currentProductSha(input.repoRoot); if(before!==input.request.productSha)throw new Error("Product SHA changed before review dispatch.");
    const requestName=`review-request-${input.request.reviewId}.json`,resultName=`review-result-${input.request.reviewId}.json`,requestPath=evidencePath(input.deliveryId,requestName),resultPath=evidencePath(input.deliveryId,resultName),requestBytes=canonicalJson(input.request);
    const existing=await this.ledger.snapshot([requestPath,resultPath]);
    if(existing.records[requestPath]!==undefined&&existing.records[requestPath]!==requestBytes)throw new Error("Immutable review request conflicts with the sealed request.");
    if(existing.records[resultPath]!==undefined){if(!existing.head||existing.records[requestPath]!==requestBytes)throw new Error("Completed review is missing its exact request.");const pinned=await this.ledger.read(existing.head,[requestPath,resultPath]);if(pinned[requestPath]!==requestBytes||pinned[resultPath]!==existing.records[resultPath])throw new Error("Pinned completed review is missing or tampered.");let resumed:ReviewResult;try{resumed=validateReviewResult(JSON.parse(pinned[resultPath]!));}catch{throw new Error("Pinned completed review is invalid.");}if(resumed.reviewId!==input.request.reviewId||resumed.productSha!==before)throw new Error("Pinned completed review does not match the sealed request.");if(await this.reviews.bundleDigest(input.envelope,requestPath,input.request)!==resumed.process.bundleDigest)throw new Error("Completed review bundle does not match the current pinned reviewer context.");if(await this.products.currentProductSha(input.repoRoot)!==before)throw new Error("Product SHA changed during completed-review resume.");return resumed;}
    const requestLedgerSha=await persistEvidence(this.ledger,input.deliveryId,requestName,input.request);
    const pinnedRequest=await this.ledger.read(requestLedgerSha,[requestPath]); if(pinnedRequest[requestPath]!==canonicalJson(input.request))throw new Error("Pinned review request is missing or tampered.");
    const afterWrite=await this.products.currentProductSha(input.repoRoot); if(afterWrite!==before)throw new Error("Product SHA changed after request persistence; review was not dispatched.");
    const dispatched=await this.reviews.dispatch(input.envelope,requestPath,input.request),result=dispatched.result;
    if(result.reviewId!==input.request.reviewId||result.productSha!==input.request.productSha)throw new Error("Reviewer result does not match the sealed request.");
    if(result.process.processId!==dispatched.attestation.processId||result.process.sessionId!==dispatched.attestation.sessionId||result.process.commandVersion!==dispatched.attestation.commandVersion||result.process.bundleDigest!==dispatched.attestation.bundleDigest)throw new Error("Reviewer result does not match its process and bundle attestation.");
    const afterReview=await this.products.currentProductSha(input.repoRoot); if(afterReview!==before)throw new Error("Product SHA changed during review; result was not persisted.");
    const resultLedgerSha=await persistEvidence(this.ledger,input.deliveryId,resultName,result);
    const records=await this.ledger.read(resultLedgerSha,[requestPath,resultPath]);
    if(records[requestPath]!==canonicalJson(input.request)||records[resultPath]!==canonicalJson(result)) throw new Error("Pinned review records are missing or tampered.");
    if(await this.products.currentProductSha(input.repoRoot)!==before)throw new Error("Product SHA changed after result persistence.");
    return result;
  }
}
