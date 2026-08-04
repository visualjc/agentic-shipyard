import type { BindingService, GitAdapter } from "../index.js";
import { createStatusProjection } from "../index.js";
import { RepositoryIdentityError } from "./setup.js";

/** Status intentionally resolves binding only: it does not acquire a lock or write any state. */
export async function status(bindings: BindingService, git: GitAdapter, repositoryPath: string) {
  try { await git.commonDirectory(repositoryPath); }
  catch { throw new RepositoryIdentityError("Git common-directory identity could not be established."); }
  const binding = await bindings.resolve(repositoryPath);
  return createStatusProjection({
    phase: "ready",
    nextSafeAction: "Run shipyard-help for the next operation; no delivery is active.",
    providerRefs: { profile: binding.profile, topology: binding.topology.kind },
  });
}
