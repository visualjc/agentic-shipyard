import type { ReviewRequest, ReviewResult } from "../evidence/types.js";
import { evidencePath, persistEvidence } from "./ledger.js";
import type { LedgerStore } from "../ledger/types.js";
import type { ProductShaReader, ContextEnvelope, PinnedLedgerReader } from "../context/types.js";
import { canonicalJson, validateReviewResult } from "../evidence/schema.js";
import { TrustedReviewDispatcher } from "../review/dispatch.js";

/** Internal orchestration body. The public factory supplies its bound scope and holds the durable lock. */
export class AcceptanceReviewService {
  constructor(private readonly products:ProductShaReader,private readonly ledger:LedgerStore & PinnedLedgerReader,private readonly reviews:TrustedReviewDispatcher) {}
  async dispatchAndPersist(rawInput:Readonly<{repoRoot:string;deliveryId:string;envelope:ContextEnvelope;request:ReviewRequest}>):Promise<ReviewResult>{
    const input=JSON.parse(canonicalJson(rawInput)) as typeof rawInput;
    const before=await this.products.currentProductSha(input.repoRoot);if(before!==input.request.productSha)throw new Error("Product SHA changed before review dispatch.");
    const requestName=`review-request-${input.request.reviewId}.json`,resultName=`review-result-${input.request.reviewId}.json`,requestPath=evidencePath(input.deliveryId,requestName),resultPath=evidencePath(input.deliveryId,resultName),requestBytes=canonicalJson(input.request);
    const existing=await this.ledger.snapshot([requestPath,resultPath]);
    if(existing.records[requestPath]!==undefined&&existing.records[requestPath]!==requestBytes)throw new Error("Immutable review request conflicts with the sealed request.");
    if(existing.records[resultPath]!==undefined){
      if(!existing.head||existing.records[requestPath]!==requestBytes)throw new Error("Completed review is missing its exact request.");
      const pinned=await this.ledger.read(existing.head,[requestPath,resultPath]);if(pinned[requestPath]!==requestBytes||pinned[resultPath]!==existing.records[resultPath])throw new Error("Pinned completed review is missing or tampered.");
      let resumed:ReviewResult;try{resumed=validateReviewResult(JSON.parse(pinned[resultPath]!));}catch{throw new Error("Pinned completed review is invalid.");}
      if(resumed.reviewId!==input.request.reviewId||resumed.productSha!==before)throw new Error("Pinned completed review does not match the sealed request.");
      if(await this.reviews.bundleDigest(input.envelope,requestPath,input.request)!==resumed.process.bundleDigest)throw new Error("Completed review bundle does not match the current pinned reviewer context.");
      if(await this.products.currentProductSha(input.repoRoot)!==before)throw new Error("Product SHA changed during completed-review resume.");return resumed;
    }
    const requestLedgerSha=await persistEvidence(this.ledger,input.deliveryId,requestName,input.request),pinnedRequest=await this.ledger.read(requestLedgerSha,[requestPath]);
    if(pinnedRequest[requestPath]!==requestBytes)throw new Error("Pinned review request is missing or tampered.");
    if(await this.products.currentProductSha(input.repoRoot)!==before)throw new Error("Product SHA changed after request persistence; review was not dispatched.");
    const dispatched=await this.reviews.dispatch(input.envelope,requestPath,input.request),result=dispatched.result;
    if(result.reviewId!==input.request.reviewId||result.productSha!==input.request.productSha)throw new Error("Reviewer result does not match the sealed request.");
    if(result.process.processId!==dispatched.attestation.processId||result.process.sessionId!==dispatched.attestation.sessionId||result.process.commandVersion!==dispatched.attestation.commandVersion||result.process.bundleDigest!==dispatched.attestation.bundleDigest)throw new Error("Reviewer result does not match its process and bundle attestation.");
    if(await this.products.currentProductSha(input.repoRoot)!==before)throw new Error("Product SHA changed during review; result was not persisted.");
    const resultLedgerSha=await persistEvidence(this.ledger,input.deliveryId,resultName,result),records=await this.ledger.read(resultLedgerSha,[requestPath,resultPath]);
    if(records[requestPath]!==requestBytes||records[resultPath]!==canonicalJson(result))throw new Error("Pinned review records are missing or tampered.");
    if(await this.products.currentProductSha(input.repoRoot)!==before)throw new Error("Product SHA changed after result persistence.");
    return result;
  }
}
