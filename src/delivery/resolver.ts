import type { BindingService } from "../binding/service.js";
import { DeliveryError } from "./errors.js";
import { validateDeliveryRegistryDocument } from "./registry.js";
import type { DeliveryRegistry, DeliveryResolutionRequest, DeliveryWorkspace, ResolvedDelivery } from "./types.js";

/**
 * Resolves every request afresh. A returned snapshot intentionally carries no
 * registry handle, lease, or mutation capability; mutators must re-read state.
 */
export class DeliveryResolver {
  constructor(private readonly bindings: BindingService, private readonly registry: DeliveryRegistry) {}

  async resolve(request: DeliveryResolutionRequest): Promise<ResolvedDelivery> {
    const binding = await this.bindings.resolve(request.repositoryPath);
    const document = validateDeliveryRegistryDocument(await this.registry.read());
    if (!document) throw new DeliveryError("delivery-registry-missing", "No local delivery registry exists for this machine.");

    let matches: DeliveryWorkspace[];
    if (request.deliveryId !== undefined) {
      matches = document.workspaces.filter((workspace) => workspace.deliveryId === request.deliveryId);
      if (matches.length === 0) throw new DeliveryError("delivery-not-found", "The requested delivery ID is not registered.");
      if (matches.length !== 1) throw new DeliveryError("delivery-duplicate", "The requested delivery ID is registered more than once.");
      if (matches[0].commonDirectory !== binding.commonDirectory) throw mismatch();
    } else {
      matches = document.workspaces.filter((workspace) => workspace.worktreePath === request.repositoryPath);
      if (matches.length === 0) {
        const repositoryWorkspaces = document.workspaces.filter((workspace) => workspace.commonDirectory === binding.commonDirectory);
        if (repositoryWorkspaces.length === 0) throw new DeliveryError("delivery-not-found", "No active delivery is registered for this bound repository.");
        if (repositoryWorkspaces.length > 1) throw new DeliveryError("delivery-ambiguous", "More than one active delivery is registered; select an explicit delivery ID.");
        throw mismatch();
      }
      if (matches.length !== 1) throw new DeliveryError("delivery-duplicate", "This worktree path is registered more than once.");
      if (matches[0].commonDirectory !== binding.commonDirectory) throw mismatch();
    }
    return immutableSnapshot(binding, matches[0]);
  }
}

function immutableSnapshot(binding: Awaited<ReturnType<BindingService["resolve"]>>, workspace: DeliveryWorkspace): ResolvedDelivery {
  return deepFreeze({ binding: structuredClone(binding), workspace: { ...workspace } });
}

function mismatch(): DeliveryError { return new DeliveryError("delivery-worktree-mismatch", "The delivery registration does not match this bound worktree's canonical repository identity."); }

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
