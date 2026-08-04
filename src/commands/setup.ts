import type { BindingService, GitAdapter, MutationLockService } from "../index.js";
import { requireMatchingTopology, requireProfileAuthorization, type ProfileReader, type TopologyRequest } from "../profile/policy.js";
import { profileFingerprint } from "../profile/fingerprint.js";

export class RepositoryIdentityError extends Error {
  readonly name = "RepositoryIdentityError";
}

export type SetupDependencies = Readonly<{
  bindings: BindingService;
  git: GitAdapter;
  locks: MutationLockService;
  profiles: ProfileReader;
  setupLockPath(commonDirectory: string): string;
  bindingMutationLockPath(): string;
}>;

export type SetupInput = Readonly<{
  repositoryPath: string;
  profile: string;
  topology: TopologyRequest;
  rebind: boolean;
  now?: () => Date;
}>;

export async function setup(dependencies: SetupDependencies, input: SetupInput) {
  const profile = await dependencies.profiles.read(input.profile);
  requireProfileAuthorization(profile, "setup");
  requireMatchingTopology(profile, input.topology);
  let commonDirectory: string;
  try { commonDirectory = await dependencies.git.commonDirectory(input.repositoryPath); }
  catch { throw new RepositoryIdentityError("Git common-directory identity could not be established."); }
  const lock = await dependencies.locks.acquire(dependencies.setupLockPath(commonDirectory), commonDirectory, "setup");
  try {
    // Fixed order: repository lock first, then the one shared Shipyard-home lock.
    const storeLock = await dependencies.locks.acquire(dependencies.bindingMutationLockPath(), "shipyard-binding-store", "setup-binding-store");
    try {
      return await dependencies.bindings.bind(input.repositoryPath, {
        profileName: profile.name,
        topology: profile.topology,
        profileFingerprint: profileFingerprint(profile),
        boundAt: (input.now ?? (() => new Date()))().toISOString(),
      }, input.rebind);
    } finally { await storeLock.release(); }
  } finally { await lock.release(); }
}
