import type { StatusContributor } from "../status/projection.js";
import type { GraphDecision } from "./types.js";

/** Pure status projection: deliberately does not probe, refresh, lock, or install anything. */
export function graphStatusContributor(input: { enabled: boolean; adapter?: string; receipt?: string; decision: GraphDecision }): StatusContributor {
  return (current) => {
    const graph = Object.freeze({ enabled: input.enabled, adapter: input.adapter, receipt: input.receipt, state: input.decision.state, reason: input.decision.reason, nextAction: input.decision.fallbackAction });
    // A graph accelerator cannot override a delivery/provider/review blocker.
    const restrictiveAction = current.blockers.length > 0 || current.nextSafeAction === "inspect-source-directly" || input.decision.state === "fresh" ? current.nextSafeAction : input.decision.fallbackAction;
    return { graphFreshness: input.decision.state, graph, nextSafeAction: restrictiveAction };
  };
}
