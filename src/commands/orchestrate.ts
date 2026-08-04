import type { ResumePlanningRequest, ShipyardOrchestrator, StartPlanningRequest } from "../orchestration/service.js";
import type { PlanningStatus } from "../orchestration/status.js";

/**
 * This is deliberately a small, authority-created facade.  A CLI caller can
 * provide a request or resume with an opaque returned ID, but cannot supply an
 * actor, provider, remote, SHA, or ledger state. Those facts remain behind
 * ShipyardOrchestrator.
 */
export interface OrchestrationOperation {
  start(input: StartPlanningRequest): Promise<PlanningStatus>;
  resume(input: ResumePlanningRequest): Promise<PlanningStatus>;
}

export function orchestrate(operation: (Pick<ShipyardOrchestrator, "start" | "resume"> | OrchestrationOperation) | undefined, input: Readonly<{ repositoryPath: string; requestText?: string; deliveryId?: string }>): Promise<PlanningStatus> {
  if (!operation) throw new Error("Planning is not configured for this bound repository. Run shipyard-setup, then shipyard-status; Shipyard will not infer a provider, actor, or tracker.");
  if (input.deliveryId !== undefined) {
    if (input.requestText !== undefined) throw new Error("Resume accepts only one delivery identifier.");
    return operation.resume({ repositoryPath: input.repositoryPath, deliveryId: deliveryId(input.deliveryId) });
  }
  if (input.requestText === undefined) throw new Error("Start requires a non-empty request.");
  // The trusted authority derives its opaque record ID from the exact bound
  // planning facts.  The public caller never controls that durable identity.
  return operation.start({ repositoryPath: input.repositoryPath, requestText: request(input.requestText) });
}

function deliveryId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error("Delivery identifier is invalid.");
  return value;
}
function request(value: string): string {
  if (!value.trim() || value.length > 16_384) throw new Error("Planning request text is invalid.");
  return value;
}
