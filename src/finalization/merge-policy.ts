import { FinalizationError } from "./errors.js";
import type { DestinationMergePolicy, FinalizationIntent, MergeObservation } from "./types.js";

/** Verify an observed human merge under the profile's declared GitHub merge policy. */
export function verifyDestinationMerge(policy:DestinationMergePolicy,intent:Pick<FinalizationIntent,"finalDestinationCommitSha"|"finalDestinationTreeSha"|"destinationMergeSha"|"destinationMainSha">,observation:MergeObservation):void{
  if(observation.mergeCommitSha!==intent.destinationMergeSha||observation.destinationMainSha!==intent.destinationMainSha||!observation.mergeCommitAncestorOfMain)throw new FinalizationError("merge-unverified","Destination merge is not reachable from the observed destination main.");
  if(policy==="merge-commit"){
    if(observation.mergeParents.length<2||!observation.finalDestinationCommitAncestorOfMerge)throw new FinalizationError("merge-unverified","Declared merge-commit policy does not contain the final destination head.");
  }else if(observation.mergeCommitTreeSha!==intent.finalDestinationTreeSha)throw new FinalizationError("merge-unverified","Declared squash/rebase merge policy does not preserve the final destination tree.");
}
