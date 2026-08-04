import { createHash } from "node:crypto";
import { MAX_REVIEW_BUNDLE_BYTES, utf8Bytes } from "../evidence/limits.js";
import { canonicalJson, canonicalJsonWithin, validateReviewRequest } from "../evidence/schema.js";
import type { ReviewRequest } from "../evidence/types.js";
import { ReviewError } from "./errors.js";

export type CanonicalReviewerRecords=Readonly<{intent:string;manifest:string;acceptance:string;instructions:string}>;

/** One byte-identical, path-redacted reviewer bundle shared by dispatch and the promotion gate. */
export function buildCanonicalReviewerBundle(rawRequest:ReviewRequest,rawRecords:CanonicalReviewerRecords):string{
  try{
    const request=validateReviewRequest(rawRequest),records=snapshotRecords(rawRecords),requestDigest=createHash("sha256").update(canonicalJson(request)).digest("hex");
    const bundle=canonicalJsonWithin({schemaVersion:1,request:{schemaVersion:request.schemaVersion,issueId:request.issueId,productSha:request.productSha,reviewId:request.reviewId,reviewedLedgerSha:request.reviewedLedgerSha,manifestDigest:request.manifestDigest,acceptanceDigest:request.acceptanceDigest,requestDigest},records},MAX_REVIEW_BUNDLE_BYTES);
    if(utf8Bytes(bundle)>MAX_REVIEW_BUNDLE_BYTES)throw new Error();return bundle;
  }catch{throw new ReviewError("review-role-mismatch","Canonical reviewer evidence is missing, invalid, or exceeds its byte limit.");}
}

export function reviewerBundleDigest(bundle:string):string{if(typeof bundle!=="string"||utf8Bytes(bundle)>MAX_REVIEW_BUNDLE_BYTES)throw new ReviewError("review-role-mismatch","Canonical reviewer bundle is invalid.");return createHash("sha256").update(bundle).digest("hex");}

function snapshotRecords(raw:CanonicalReviewerRecords):CanonicalReviewerRecords{if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.getPrototypeOf(raw)!==Object.prototype||Reflect.ownKeys(raw).sort().join(",")!=="acceptance,instructions,intent,manifest")throw new Error();const out:Record<string,string>={};for(const key of ["intent","manifest","acceptance","instructions"] as const){const descriptor=Object.getOwnPropertyDescriptor(raw,key);if(!descriptor||!descriptor.enumerable||!("value" in descriptor)||typeof descriptor.value!=="string")throw new Error();out[key]=descriptor.value;}return Object.freeze(out) as CanonicalReviewerRecords;}
