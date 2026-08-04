import type { ContextAuthorityScope, ContextReader } from "../context/reader.js";
import type { ContextEnvelope, PinnedLedgerReader, ProductShaReader } from "../context/types.js";
import { CodexReviewAdapter, type CodexReviewConfig } from "../adapters/codex-review.js";
import type { FilesystemAdapter } from "../adapters/filesystem.js";
import { TrustedReviewDispatcher } from "./dispatch.js";
import { AcceptanceReviewService } from "../acceptance/service.js";
import type { LedgerStore } from "../ledger/types.js";
import type { MutationLockService } from "../locking/mutation-lock.js";
import type { ReviewRequest, ReviewResult } from "../evidence/types.js";
import { canonicalJson, validateReviewRequest } from "../evidence/schema.js";
import { isAbsolute, join } from "node:path";
import { ReviewError } from "./errors.js";

export type TrustedCodexReviewConfig = CodexReviewConfig;
export type TrustedCodexReviewOperationDependencies=Readonly<{context:ContextReader;products:ProductShaReader;ledger:LedgerStore & PinnedLedgerReader;mutationLocks:MutationLockService;filesystem:Pick<FilesystemAdapter,"realpath"|"isDirectory">;codex:TrustedCodexReviewConfig}>;
export interface TrustedCodexReviewOperation { dispatchAndPersist(input:Readonly<{envelope:ContextEnvelope;request:ReviewRequest}>):Promise<ReviewResult>; }

function createTrustedCodexReviewer(context:ContextReader,config:TrustedCodexReviewConfig):TrustedReviewDispatcher{return new TrustedReviewDispatcher(context,Object.freeze({codex:new CodexReviewAdapter(config)}));}

/** Public construction path: live bound scope determines both repository identity and the one durable lock path. */
export function createTrustedCodexReviewOperation(rawDependencies:TrustedCodexReviewOperationDependencies):TrustedCodexReviewOperation{
  const dependencies=construction(rawDependencies),context=dependencies.context as ContextReader,products=dependencies.products as ProductShaReader,ledger=dependencies.ledger as LedgerStore & PinnedLedgerReader,mutationLocks=dependencies.mutationLocks as MutationLockService,filesystem=dependencies.filesystem as Pick<FilesystemAdapter,"realpath"|"isDirectory">,reviewer=createTrustedCodexReviewer(context,dependencies.codex as TrustedCodexReviewConfig),service=new AcceptanceReviewService(products,ledger,reviewer);
  return Object.freeze({async dispatchAndPersist(rawInput:Readonly<{envelope:ContextEnvelope;request:ReviewRequest}>){
    const input=reviewInput(rawInput),initial=await canonicalScope(await context.authorityScope(),filesystem),lockPath=join(initial.commonDirectory,"shipyard-review.lock"),acquired=await mutationLocks.acquire(lockPath,initial.commonDirectory,`independent-review:${initial.deliveryId}:${input.request.reviewId}`);
    try{const current=await canonicalScope(await context.authorityScope(),filesystem);if(!sameScope(initial,current))throw new ReviewError("review-role-mismatch","Bound review authority changed while acquiring its durable lock.");const result=await service.dispatchAndPersist({repoRoot:current.repoRoot,deliveryId:current.deliveryId,envelope:input.envelope,request:input.request}),finalScope=await canonicalScope(await context.authorityScope(),filesystem);if(!sameScope(current,finalScope))throw new ReviewError("review-role-mismatch","Bound review authority changed during review persistence.");return result;}finally{await acquired.release();}
  }});
}

async function canonicalScope(raw:ContextAuthorityScope,filesystem:Pick<FilesystemAdapter,"realpath"|"isDirectory">):Promise<ContextAuthorityScope>{
  try{const scope=JSON.parse(canonicalJson(raw));if(!scope||typeof scope!=="object"||Object.keys(scope).sort().join(",")!=="actorLogin,commonDirectory,deliveryId,repoRoot"||!isAbsolute(scope.repoRoot)||typeof scope.deliveryId!=="string"||!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(scope.deliveryId)||!isAbsolute(scope.commonDirectory)||scope.commonDirectory==="/"||typeof scope.actorLogin!=="string"||scope.actorLogin.trim()===""||!await filesystem.isDirectory(scope.commonDirectory))throw new Error();const [repoRoot,commonDirectory]=await Promise.all([filesystem.realpath(scope.repoRoot),filesystem.realpath(scope.commonDirectory)]);if(repoRoot!==scope.repoRoot||commonDirectory!==scope.commonDirectory)throw new Error();return Object.freeze(scope);}catch{throw new ReviewError("review-role-mismatch","Bound review repository scope is not canonical.");}
}
function sameScope(left:ContextAuthorityScope,right:ContextAuthorityScope):boolean{return left.repoRoot===right.repoRoot&&left.deliveryId===right.deliveryId&&left.commonDirectory===right.commonDirectory&&left.actorLogin===right.actorLogin;}
function reviewInput(value:unknown):Readonly<{envelope:ContextEnvelope;request:ReviewRequest}>{try{const input=JSON.parse(canonicalJson(value));if(!input||typeof input!=="object"||Object.keys(input).sort().join(",")!=="envelope,request")throw new Error();return Object.freeze({envelope:input.envelope as ContextEnvelope,request:validateReviewRequest(input.request)});}catch{throw new ReviewError("review-role-mismatch","Trusted review input is invalid.");}}
function construction(value:unknown):Record<string,unknown>{const allowed=["context","products","ledger","mutationLocks","filesystem","codex"];if(!value||typeof value!=="object"||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new ReviewError("review-process-failed","Trusted review construction is invalid.");const out:Record<string,unknown>={};for(const key of Reflect.ownKeys(value)){if(typeof key!=="string"||!allowed.includes(key))throw new ReviewError("review-process-failed","Trusted review construction is invalid.");const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!descriptor.enumerable||!("value" in descriptor))throw new ReviewError("review-process-failed","Trusted review construction is invalid.");out[key]=descriptor.value;}if(allowed.some(key=>!(key in out)))throw new ReviewError("review-process-failed","Trusted review construction is invalid.");return out;}
