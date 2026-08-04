import { ReviewError } from "./errors.js";
import type { IndependentReviewAdapter, ReviewDispatch, ReviewDispatchResult } from "./types.js";
import type { ReviewRequest } from "../evidence/types.js";
import type { ContextEnvelope } from "../context/types.js";
import type { ContextReader } from "../context/reader.js";
/** The caller cannot select a role: this narrow port only dispatches reviewer work. */
export class ReviewDispatcher { constructor(private readonly adapters: Readonly<Record<string, IndependentReviewAdapter>>) {} async dispatch(input: ReviewDispatch, request: ReviewRequest): Promise<ReviewDispatchResult> { if(input.role!=="reviewer")throw new ReviewError("review-role-mismatch","Only trusted reviewer dispatches may start a review."); const adapter=this.adapters[input.host]; if(!adapter)throw new ReviewError("review-unsupported-host",`Unsupported reviewer host: ${input.host}`); return adapter.review(input,request); } }
/** Bridges Issue #3's pinned, role-limited context guard to a host-neutral reviewer adapter. */
export class TrustedReviewDispatcher {
  constructor(private readonly context: ContextReader, private readonly adapters: Readonly<Record<string, IndependentReviewAdapter>>) {}
  async dispatch(envelope: ContextEnvelope, reviewRequestPath: string, request: ReviewRequest): Promise<ReviewDispatchResult> {
    const loaded=await this.context.load(envelope); // Product SHA guard and pinned ledger read happen before spawn.
    if(loaded.envelope.role!=="reviewer"||request.reviewerEnvelopePath!==loaded.envelope.adapter.envelopePath||request.productSha!==loaded.envelope.productSha)
      throw new ReviewError("review-role-mismatch","Trusted reviewer context does not match the sealed review request.");
    const adapter=this.adapters[loaded.envelope.host]; if(!adapter)throw new ReviewError("review-unsupported-host",`Unsupported reviewer host: ${loaded.envelope.host}`);
    return adapter.review(Object.freeze({host:loaded.envelope.host,role:"reviewer",reviewRequestPath,reviewerEnvelopePath:loaded.envelope.adapter.envelopePath,repoRoot:loaded.envelope.adapter.repoRoot}),request);
  }
}
