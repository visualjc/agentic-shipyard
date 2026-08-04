import type { ContextReader } from "../context/reader.js";
import type { ContextEnvelope, PinnedLedgerReader, ProductShaReader } from "../context/types.js";
import { CodexReviewAdapter, type CodexReviewConfig } from "../adapters/codex-review.js";
import { TrustedReviewDispatcher } from "./dispatch.js";
import { AcceptanceReviewService, type ReviewMutationLock } from "../acceptance/service.js";
import type { LedgerStore } from "../ledger/types.js";
import type { MutationLockService } from "../locking/mutation-lock.js";
import type { ReviewRequest, ReviewResult } from "../evidence/types.js";
import { isAbsolute } from "node:path";

export type TrustedCodexReviewConfig = CodexReviewConfig;
export type TrustedCodexReviewOperationDependencies=Readonly<{
  context:ContextReader;
  products:ProductShaReader;
  ledger:LedgerStore & PinnedLedgerReader;
  mutationLocks:MutationLockService;
  mutationLockPath:string;
  codex:TrustedCodexReviewConfig;
}>;
export interface TrustedCodexReviewOperation {
  dispatchAndPersist(input:Readonly<{repoRoot:string;deliveryId:string;envelope:ContextEnvelope;request:ReviewRequest}>):Promise<ReviewResult>;
}

function createTrustedCodexReviewer(context: ContextReader, config: TrustedCodexReviewConfig): TrustedReviewDispatcher {
  return new TrustedReviewDispatcher(context, Object.freeze({ codex: new CodexReviewAdapter(config) }));
}

/** Public construction path: pinned context, durable mutation lock, and Codex are inseparable. */
export function createTrustedCodexReviewOperation(dependencies:TrustedCodexReviewOperationDependencies):TrustedCodexReviewOperation {
  const {context,products,ledger,mutationLocks,mutationLockPath,codex}=dependencies;
  if(typeof mutationLockPath!=="string"||mutationLockPath.trim()===""||mutationLockPath.includes("\0")||!isAbsolute(mutationLockPath)||mutationLockPath==="/")throw new Error("A canonical absolute review mutation-lock path is required.");
  const tails=new Map<string,Promise<void>>();
  const lock:ReviewMutationLock={async withReviewLock(identity,operation){
    const previous=tails.get(identity.repository)??Promise.resolve();
    let releaseQueue!:()=>void;
    const current=new Promise<void>(resolve=>{releaseQueue=resolve;});
    tails.set(identity.repository,current);
    await previous.catch(()=>undefined);
    try {
      const acquired=await mutationLocks.acquire(mutationLockPath,identity.repository,`independent-review:${identity.deliveryId}:${identity.reviewId}`);
      try{return await operation();}finally{await acquired.release();}
    } finally {
      releaseQueue();
      if(tails.get(identity.repository)===current)tails.delete(identity.repository);
    }
  }};
  return new AcceptanceReviewService(products,ledger,createTrustedCodexReviewer(context,codex),lock);
}
