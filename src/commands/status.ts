import { BindingService, createStatusProjection } from "../index.js";

/** Status intentionally resolves binding only: it does not acquire a lock or write any state. */
export async function status(bindings: BindingService, repositoryPath: string) {
  const binding = await bindings.resolve(repositoryPath);
  return createStatusProjection({
    phase: "ready",
    nextSafeAction: "Run shipyard-help for the next operation; no delivery is active.",
    providerRefs: { profile: binding.profile, topology: binding.topology.kind },
  });
}
