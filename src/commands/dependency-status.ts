import type { CapabilityHost, CapabilityLane } from "../dependencies/types.js";
import type { DependencyStatusService } from "../dependencies/service.js";

/** Read-only setup/status preflight. It deliberately does not bind, lock, repair, or dispatch. */
export async function dependencyStatus(service: Pick<DependencyStatusService, "inspect">, selected: Readonly<{ host: CapabilityHost; lane: CapabilityLane }>) {
  return service.inspect(selected);
}
