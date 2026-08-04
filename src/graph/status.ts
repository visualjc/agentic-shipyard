import type { StatusContributor } from "../status/projection.js";
import type { GraphDecision } from "./types.js";
import { graphDecision } from "./freshness.js";
import { validateGraphDecision } from "./validation.js";

/** Pure status projection: deliberately does not probe, refresh, lock, or install anything. */
export function graphStatusContributor(input: { enabled: boolean; adapter?: string; receipt?: string; decision: GraphDecision }): StatusContributor {
  let snapshot: { enabled: boolean; adapter?: string; receipt?: string; decision: GraphDecision };
  try { const fields = Object.getOwnPropertyDescriptors(input); if (Object.values(fields).some(field => !("value" in field))) throw new Error(); const value = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])) as Record<string, unknown>; if (typeof value.enabled !== "boolean" || (value.adapter !== undefined && typeof value.adapter !== "string") || (value.receipt !== undefined && typeof value.receipt !== "string")) throw new Error(); snapshot = { enabled: value.enabled, ...(typeof value.adapter === "string" ? { adapter: value.adapter } : {}), ...(typeof value.receipt === "string" ? { receipt: value.receipt } : {}), decision: validateGraphDecision(value.decision) }; }
  catch { snapshot = { enabled: false, decision: graphDecision("invalid", "Graph status input is invalid.") }; }
  return (current) => {
    const graph = Object.freeze({ enabled: snapshot.enabled, adapter: snapshot.adapter, receipt: snapshot.receipt, state: snapshot.decision.state, reason: snapshot.decision.reason, nextAction: snapshot.decision.fallbackAction });
    // A graph accelerator cannot override a delivery/provider/review blocker.
    const restrictiveAction = current.blockers.length > 0 || current.nextSafeAction === "inspect-source-directly" || snapshot.decision.state === "fresh" ? current.nextSafeAction : snapshot.decision.fallbackAction;
    return { graphFreshness: snapshot.decision.state, graph, nextSafeAction: restrictiveAction };
  };
}
