import { ReviewError } from "./errors.js";
import type { IndependentReviewAdapter, ReviewDispatch, ReviewDispatchResult } from "./types.js";
import type { ReviewRequest } from "../evidence/types.js";
import type { ContextEnvelope } from "../context/types.js";
import type { ContextReader } from "../context/reader.js";
import { canonicalJson, validateAcceptanceEvidence, validateEvidenceManifest, validateReviewRequest } from "../evidence/schema.js";
import { createHash } from "node:crypto";
import { buildCanonicalReviewerBundle, reviewerBundleDigest } from "./bundle.js";
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
    return reviewerBundleDigest(dispatch.sealedBundle);
  }
  private async seal(envelope: ContextEnvelope, reviewRequestPath: string, request: ReviewRequest): Promise<ReviewDispatch> {
    const loaded=await this.context.load(envelope); // Product SHA guard and pinned ledger read happen before spawn.
    const prefix=`deliveries/${loaded.envelope.deliveryId}`,canonicalRequestPath=`${prefix}/evidence/review-request-${request.reviewId}.json`,manifestPath=`${prefix}/evidence/manifest.json`,acceptancePath=`${prefix}/evidence/acceptance.json`,intentPath=`${prefix}/intent.md`;
    if(loaded.envelope.host!=="codex")throw new ReviewError("review-unsupported-host","Shipyard v1 supports the Codex reviewer host only.");
    if(loaded.envelope.role!=="reviewer"||reviewRequestPath!==canonicalRequestPath||request.reviewerEnvelopePath!==loaded.envelope.adapter.envelopePath||request.productSha!==loaded.envelope.productSha||!request.intentRefs.includes(intentPath)||!request.evidenceRefs.includes(acceptancePath))
      throw new ReviewError("review-role-mismatch","Trusted reviewer context does not match the sealed review request.");
    let manifest,acceptance;try{manifest=validateEvidenceManifest(JSON.parse(loaded.records[manifestPath]!));acceptance=validateAcceptanceEvidence(JSON.parse(loaded.records[acceptancePath]!));const manifestBytes=canonicalJson(manifest),acceptanceBytes=canonicalJson(acceptance);if(manifestBytes!==loaded.records[manifestPath]||acceptanceBytes!==loaded.records[acceptancePath]||manifest.issueId!==request.issueId||acceptance.issueId!==manifest.issueId||acceptance.productSha!==request.productSha||request.reviewedLedgerSha!==loaded.envelope.ledgerSha||request.manifestDigest!==createHash("sha256").update(manifestBytes).digest("hex")||request.acceptanceDigest!==createHash("sha256").update(acceptanceBytes).digest("hex"))throw new Error();}catch{throw new ReviewError("review-role-mismatch","Reviewer manifest and acceptance evidence do not match the sealed request.");}
    // The child receives an opaque, role-minimal view only. In particular it
    // must not learn mutable source-worktree, ledger, or envelope paths.
    const sealedBundle=buildCanonicalReviewerBundle(request,{intent:loaded.records[intentPath]!,manifest:loaded.records[manifestPath]!,acceptance:loaded.records[acceptancePath]!,instructions:loaded.records[`${prefix}/review.json`]!});
    return Object.freeze({host:loaded.envelope.host,role:"reviewer",reviewRequestPath,reviewerEnvelopePath:loaded.envelope.adapter.envelopePath,repoRoot:loaded.envelope.adapter.repoRoot,sealedBundle});
  }
}
