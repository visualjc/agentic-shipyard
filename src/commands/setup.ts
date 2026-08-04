import type { BindingService, GitAdapter, MutationLockService, RepositoryTopology } from "../index.js";
import type { GlobalProfileStore } from "../cli/profile-store.js";
import { requireMatchingTopology } from "../cli/profile-store.js";

export class RepositoryIdentityError extends Error {
  readonly name = "RepositoryIdentityError";
}

export type SetupDependencies = Readonly<{
  bindings: BindingService;
  git: GitAdapter;
  locks: MutationLockService;
  profiles: GlobalProfileStore;
  setupLockPath(commonDirectory: string): string;
}>;

export type SetupInput = Readonly<{
  repositoryPath: string;
  profile: string;
  topology: RepositoryTopology;
  rebind: boolean;
  now?: () => Date;
}>;

export async function setup(dependencies: SetupDependencies, input: SetupInput) {
  const profile = await dependencies.profiles.read(input.profile);
  requireMatchingTopology(profile, input.topology);
  let commonDirectory: string;
  try { commonDirectory = await dependencies.git.commonDirectory(input.repositoryPath); }
  catch { throw new RepositoryIdentityError("Git common-directory identity could not be established."); }
  const lock = await dependencies.locks.acquire(dependencies.setupLockPath(commonDirectory), commonDirectory, "setup");
  try {
    return await dependencies.bindings.bind(input.repositoryPath, {
      profile: profile.name,
      topology: input.topology,
      createdAt: (input.now ?? (() => new Date()))().toISOString(),
    }, input.rebind);
  } finally { await lock.release(); }
}
