import { ReviewError } from "./errors.js";
import type { IndependentReviewAdapter, ReviewDispatch, ReviewDispatchResult } from "./types.js";
import type { ReviewRequest } from "../evidence/types.js";
import type { ContextEnvelope } from "../context/types.js";
import type { ContextReader } from "../context/reader.js";
import { canonicalJson, canonicalJsonWithin, validateAcceptanceEvidence, validateEvidenceManifest, validateReviewRequest } from "../evidence/schema.js";
import { createHash } from "node:crypto";
import { MAX_REVIEW_BUNDLE_BYTES, utf8Bytes } from "../evidence/limits.js";
/** Bridges Issue #3's pinned, role-limited context guard to a host-neutral reviewer adapter. */
export class TrustedReviewDispatcher {
  constructor(private readonly context: ContextReader, private readonly adapters: Readonly<Record<string, IndependentReviewAdapter>>) {}
  async dispatch(envelope: ContextEnvelope, reviewRequestPath: string, request: ReviewRequest): Promise<ReviewDispatchResult> {
    const validated=validateReviewRequest(request),dispatch=await this.seal(envelope,reviewRequestPath,validated),adapter=this.adapters.codex;
    if(!adapter)throw new ReviewError("review-unsupported-host","Codex reviewer adapter is unavailable.");
    return adapter.review(dispatch,validated);
  }
  async bundleDigest(envelope:ContextEnvelope,reviewRequestPath:string,request:ReviewRequest):Promise<string>{
    const dispatch=await this.seal(envelope,reviewRequestPath,validateReviewRequest(request));
    return createHash("sha256").update(dispatch.sealedBundle).digest("hex");
  }
  private async seal(envelope: ContextEnvelope, reviewRequestPath: string, request: ReviewRequest): Promise<ReviewDispatch> {
    const loaded=await this.context.load(envelope); // Product SHA guard and pinned ledger read happen before spawn.
    const prefix=`deliveries/${loaded.envelope.deliveryId}`,canonicalRequestPath=`${prefix}/evidence/review-request-${request.reviewId}.json`,manifestPath=`${prefix}/evidence/manifest.json`,acceptancePath=`${prefix}/evidence/acceptance.json`,intentPath=`${prefix}/intent.md`;
    if(loaded.envelope.host!=="codex")throw new ReviewError("review-unsupported-host","Shipyard v1 supports the Codex reviewer host only.");
    if(loaded.envelope.role!=="reviewer"||reviewRequestPath!==canonicalRequestPath||request.reviewerEnvelopePath!==loaded.envelope.adapter.envelopePath||request.productSha!==loaded.envelope.productSha||!request.intentRefs.includes(intentPath)||!request.evidenceRefs.includes(acceptancePath))
      throw new ReviewError("review-role-mismatch","Trusted reviewer context does not match the sealed review request.");
    let manifest,acceptance;try{manifest=validateEvidenceManifest(JSON.parse(loaded.records[manifestPath]!));acceptance=validateAcceptanceEvidence(JSON.parse(loaded.records[acceptancePath]!));if(canonicalJson(manifest)!==loaded.records[manifestPath]||canonicalJson(acceptance)!==loaded.records[acceptancePath]||manifest.issueId!==request.issueId||acceptance.issueId!==manifest.issueId||acceptance.productSha!==request.productSha)throw new Error();}catch{throw new ReviewError("review-role-mismatch","Reviewer manifest and acceptance evidence do not match the sealed request.");}
    let sealedBundle:string;try{sealedBundle=canonicalJsonWithin({schemaVersion:1,envelope:loaded.envelope,request,records:loaded.records},MAX_REVIEW_BUNDLE_BYTES);}catch{throw new ReviewError("review-role-mismatch","Sealed reviewer context exceeds its byte limit.");}if(utf8Bytes(sealedBundle)>MAX_REVIEW_BUNDLE_BYTES)throw new ReviewError("review-role-mismatch","Sealed reviewer context exceeds its byte limit.");
    return Object.freeze({host:loaded.envelope.host,role:"reviewer",reviewRequestPath,reviewerEnvelopePath:loaded.envelope.adapter.envelopePath,repoRoot:loaded.envelope.adapter.repoRoot,sealedBundle});
  }
}
