import type { BindingService, GitAdapter } from "../index.js";
import { createStatusProjection } from "../index.js";
import { requireProfileAuthorization, sameTopology, type ProfileReader } from "../profile/policy.js";
import { RepositoryIdentityError } from "./setup.js";

/** Status intentionally resolves binding only: it does not acquire a lock or write any state. */
export async function status(bindings: BindingService, git: GitAdapter, profiles: ProfileReader, repositoryPath: string) {
  try { await git.commonDirectory(repositoryPath); }
  catch { throw new RepositoryIdentityError("Git common-directory identity could not be established."); }
  const binding = await bindings.resolve(repositoryPath);
  const profile = await profiles.read(binding.profileName);
  requireProfileAuthorization(profile, "status");
  if (!sameTopology(profile.topology, binding.topology)) throw new Error(`Bound profile ${binding.profileName} topology has changed; run shipyard-setup --rebind after verifying it.`);
  return createStatusProjection({
    phase: "ready",
    nextSafeAction: "Run shipyard-help for the next operation; no delivery is active.",
    providerRefs: { profile: binding.profileName, topology: binding.topology.kind },
  });
}
