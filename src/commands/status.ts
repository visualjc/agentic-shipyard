import type { GitAdapter } from "../adapters/git.js";
import type { BindingService } from "../binding/service.js";
import { composeStatus, createStatusProjection } from "../status/projection.js";
import { graphStatusContributor } from "../graph/status.js";
import { graphDecision } from "../graph/freshness.js";
import type { GraphLaneStatusReader } from "../graph/service.js";
import { requireProfileAuthorization, sameTopology, type ProfileReader } from "../profile/policy.js";
import { profileFingerprint } from "../profile/fingerprint.js";
import { RepositoryIdentityError } from "./setup.js";
import { syncStatusContributor, type SyncStatusReader } from "../sync/status.js";

/** Status intentionally resolves binding only: it does not acquire a lock or write any state. */
export async function status(bindings: Pick<BindingService, "resolve">, git: GitAdapter, profiles: ProfileReader, repositoryPath: string, syncReader: SyncStatusReader, graphs?: GraphLaneStatusReader) {
  try { await git.commonDirectory(repositoryPath); }
  catch { throw new RepositoryIdentityError("Git common-directory identity could not be established."); }
  const binding = await bindings.resolve(repositoryPath);
  const profile = await profiles.read(binding.profileName);
  requireProfileAuthorization(profile, "status");
  if (!sameTopology(profile.topology, binding.topology) || profileFingerprint(profile) !== binding.profileFingerprint) throw new Error(`Bound profile ${binding.profileName} authority has changed; run shipyard-setup --rebind after verifying it.`);
  const destination = binding.topology.kind === "staged-pair" ? binding.topology.destination : binding.topology.repository;
  const development = binding.topology.kind === "staged-pair" ? binding.topology.development : binding.topology.repository;
  const sync = await syncReader.read({ repositoryPath, destinationRemote: destination.remote.name, developmentBranch: development.defaultBranch, destinationBranch: destination.defaultBranch, expectedRemoteUrl: destination.remote.url, profile });
  const base = composeStatus(createStatusProjection({
    phase: "ready",
    nextSafeAction: "Inspect local synchronization facts.",
    providerRefs: { profile: binding.profileName, topology: binding.topology.kind, destinationRemote: destination.remote.name, destinationBranch: destination.defaultBranch },
  }), [syncStatusContributor(sync)]);
  if (!graphs) return base;
  let graph; try { graph = await graphs.status(profile, repositoryPath); }
  catch { graph = { enabled: profile.graph?.enabled === true, adapter: profile.graph?.enabled ? profile.graph.adapter : undefined, receipt: profile.graph?.enabled ? profile.graph.reviewedToolSource : undefined, decision: graphDecision("unavailable", "Graph status boundary failed safely.") }; }
  return composeStatus(base, [graphStatusContributor(graph)]);
}
