import type { EvidenceDecision } from "../evidence/types.js";
import type { StatusContributor } from "../status/projection.js";
export const acceptanceStatusContributor = (decision: EvidenceDecision): StatusContributor => (current) => ({acceptanceFresh:decision.acceptanceFresh,blockers:decision.blockers.map(code=>({code,message:code.replaceAll("-"," ")})),nextSafeAction:current.blockers.length>0?current.nextSafeAction:decision.nextAction});
