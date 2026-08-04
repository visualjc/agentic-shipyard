import type { Binding, Operation, Topology } from "../contracts/types.js";
import { profileFingerprint } from "./fingerprint.js";
import { requireProfileAuthorization, sameTopology, type ProfileReader } from "./policy.js";
import type { BindingService } from "../binding/service.js";
import { BindingError } from "../binding/errors.js";

/**
 * Fresh authority derived only from the active binding and its named global
 * profile.  It deliberately excludes credentials and caller-selected targets.
 */
export type BoundProfileAuthority = Readonly<{
  profileName: string;
  commonDirectory: string;
  profileFingerprint: string;
  actorLogin: string;
  topology: Readonly<Topology>;
}>;

/** Runtime seam for consumers that must revalidate profile/binding authority. */
export interface BoundProfileAuthorityResolver {
  resolve(repositoryPath: string, operation?: Operation): Promise<BoundProfileAuthority>;
}

/**
 * Resolves a binding afresh and pins it to the current named profile before a
 * caller may derive an actor or repository.  A stale/forged profile or
 * topology never becomes an authority snapshot.
 */
export class ActiveBoundProfileAuthorityResolver implements BoundProfileAuthorityResolver {
  constructor(private readonly bindings: BindingService, private readonly profiles: ProfileReader) {}

  async resolve(repositoryPath: string, operation?: Operation): Promise<BoundProfileAuthority> {
    const binding = await this.bindings.resolve(repositoryPath);
    const profile = await this.profiles.read(binding.profileName);
    if (profile.name !== binding.profileName || !sameTopology(profile.topology, binding.topology) || profileFingerprint(profile) !== binding.profileFingerprint) {
      throw new BindingError("binding-stale", `Bound profile ${binding.profileName} authority has changed; run shipyard-setup --rebind after verifying it.`);
    }
    if (operation !== undefined) requireProfileAuthorization(profile, operation);
    return freeze({
      profileName: binding.profileName,
      commonDirectory: binding.commonDirectory,
      profileFingerprint: binding.profileFingerprint,
      actorLogin: profile.actor.login,
      topology: structuredClone(binding.topology),
    });
  }
}

/** Makes fake resolvers and integration adapters prove the same immutable shape. */
export function boundProfileAuthority(binding: Binding, actorLogin: string): BoundProfileAuthority {
  return freeze({
    profileName: binding.profileName,
    commonDirectory: binding.commonDirectory,
    profileFingerprint: binding.profileFingerprint,
    actorLogin,
    topology: structuredClone(binding.topology),
  });
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
