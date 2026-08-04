import { createHash } from "node:crypto";
import { validateProfile } from "../contracts/validate.js";
import type { Profile, RepositoryRef } from "../contracts/types.js";

/**
 * Version 1 profile identity: SHA-256 of UTF-8 JSON for the explicitly ordered
 * canonical profile projection. Validation happens first, so unknown fields and
 * malformed policies cannot acquire an identity. Arrays retain their declared
 * order because operation/rule order is part of the authored authority.
 */
export const PROFILE_FINGERPRINT_ALGORITHM = "shipyard-profile-v1:sha256";

export function profileFingerprint(value: unknown): string {
  const profile = validateProfile(value);
  return createHash("sha256").update(JSON.stringify(canonicalProfile(profile)), "utf8").digest("hex");
}

function canonicalProfile(profile: Profile) {
  const repository = (value: RepositoryRef) => ({
    owner: value.owner, name: value.name,
    remote: { name: value.remote.name, url: value.remote.url }, defaultBranch: value.defaultBranch,
  });
  const topology = profile.topology.kind === "staged-pair"
    ? { kind: "staged-pair", development: repository(profile.topology.development), destination: repository(profile.topology.destination) }
    : { kind: "single-repository", repository: repository(profile.topology.repository) };
  return {
    algorithm: PROFILE_FINGERPRINT_ALGORITHM,
    schemaVersion: profile.schemaVersion, name: profile.name, actor: { login: profile.actor.login }, topology,
    allowedOperations: [...profile.allowedOperations],
    pathPolicy: { schemaVersion: profile.pathPolicy.schemaVersion, rules: profile.pathPolicy.rules.map((rule) => ({ owner: rule.owner, pattern: rule.pattern })) },
  };
}
