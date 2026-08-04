import type { EvidenceDecision } from "../evidence/types.js";
import type { StatusContributor } from "../status/projection.js";
const restrictive=(action:string)=>/^(repair|resolve|renew|gather|rebind|recover|retry)-/.test(action);
export const acceptanceStatusContributor = (decision: EvidenceDecision): StatusContributor => (current) => ({acceptanceFresh:decision.acceptanceFresh,blockers:decision.blockers.map(code=>({code,message:code.replaceAll("-"," ")})),nextSafeAction:current.blockers.length>0||restrictive(current.nextSafeAction)?current.nextSafeAction:decision.nextAction});
