import { join } from "node:path";
import type { FilesystemAdapter } from "../adapters/filesystem.js";
import type { Profile } from "../contracts/types.js";
import { validateProfile } from "../contracts/validate.js";

export class ProfileStoreError extends Error {
  readonly name = "ProfileStoreError";
  constructor(readonly code: "profile-name-invalid" | "profile-missing" | "profile-invalid" | "profile-name-mismatch" | "profile-topology-mismatch" | "profile-operation-denied", message: string) { super(message); }
}

/** Canonical profiles are user-managed global inputs; setup never creates or repairs them. */
export class GlobalProfileStore {
  constructor(private readonly filesystem: FilesystemAdapter, private readonly home: string) {}

  async read(name: string): Promise<Profile> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      throw new ProfileStoreError("profile-name-invalid", "Profile names may contain only letters, numbers, dots, underscores, and hyphens.");
    }
    const path = join(this.home, "profiles", `${name}.json`);
    const text = await this.filesystem.readText(path);
    if (text === undefined) throw new ProfileStoreError("profile-missing", `Global profile ${name} does not exist.`);
    let value: unknown;
    try { value = JSON.parse(text); }
    catch { throw new ProfileStoreError("profile-invalid", `Global profile ${name} is not valid JSON.`); }
    let profile: Profile;
    try { profile = validateProfile(value); }
    catch { throw new ProfileStoreError("profile-invalid", `Global profile ${name} does not match the version 1 profile schema.`); }
    if (profile.name !== name) throw new ProfileStoreError("profile-name-mismatch", `Profile document ${name} declares a different name.`);
    return profile;
  }
}
