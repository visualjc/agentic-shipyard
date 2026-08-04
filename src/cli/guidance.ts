import { BindingError } from "../binding/errors.js";
import { MutationLockError } from "../locking/mutation-lock.js";
import { RepositoryIdentityError } from "../commands/setup.js";
import { ProfileStoreError } from "./profile-store.js";
import { SyncError } from "../sync/errors.js";

export function commandGuidance(error: unknown, command: string): string {
  if (error instanceof SyncError) return error.message;
  if (error instanceof BindingError) {
    switch (error.code) {
      case "repository-unbound": return "No binding was found. Run shipyard-setup with the complete, existing topology.";
      case "binding-duplicate": return "More than one binding matches this repository. Repair the local binding store, then run shipyard-setup --rebind only after verifying the topology.";
      case "binding-stale": return "The existing binding cannot be safely reused. Verify the repository identity and run shipyard-setup --rebind with the complete topology.";
      case "binding-remote-mismatch": return "A configured remote differs from the binding. Shipyard will not rewrite remotes; correct it yourself, then run shipyard-setup --rebind.";
      case "topology-incomplete": return "The topology is incomplete. Provide every required remote name and URL to shipyard-setup.";
      case "topology-invalid": return "The topology is invalid. A staged pair needs distinct existing remotes; a single repository has only development.";
      case "binding-store-invalid": return "The local binding store is invalid. Restore or repair it before running shipyard-setup --rebind.";
      case "profile-topology-mismatch": return "The requested repository topology does not match the named global profile. Verify the profile and CLI remote identity before rerunning shipyard-setup.";
      case "profile-operation-denied": return "The named global profile does not authorize this operation. Update and review its allowed operations before rerunning shipyard-setup.";
    }
  }
  if (error instanceof ProfileStoreError) {
    switch (error.code) {
      case "profile-missing": return "The named global profile is missing. Create and review its version 1 JSON document under $SHIPYARD_HOME/profiles, then rerun shipyard-setup.";
      case "profile-invalid": return "The named global profile is malformed. Repair its version 1 schema before rerunning shipyard-setup; Shipyard will not create it automatically.";
      case "profile-name-invalid": return "The profile name is unsafe. Use its exact global profile identifier with shipyard-setup.";
      case "profile-name-mismatch": return "The global profile file and its declared name differ. Correct the profile document before rerunning shipyard-setup.";
      case "profile-topology-mismatch": return "The requested repository topology does not match the named global profile. Verify the profile and CLI remote identity before rerunning shipyard-setup.";
      case "profile-operation-denied": return "The named global profile does not authorize setup. Update and review its allowed operations before rerunning shipyard-setup.";
    }
  }
  if (error instanceof MutationLockError) {
    const retry = command === "sync" ? "shipyard-sync" : "shipyard-setup";
    const operation = command === "sync" ? "Sync" : "Setup";
    switch (error.code) {
      case "lock-held": return `${operation} is blocked by another repository mutation. Wait for that owner to finish, then rerun shipyard-status before retrying ${retry}.`;
      case "lock-invalid": return `The repository mutation lock is malformed or names another identity. Inspect it manually; Shipyard will not remove it automatically. Rerun shipyard-status before retrying ${retry}.`;
      case "lock-unsafe-recovery": return `The repository mutation lock requires manual recovery. Verify that its recorded owner is no longer active in every checkout or container sharing this path, remove only that record, then rerun shipyard-status before retrying ${retry}.`;
    }
  }
  if (error instanceof RepositoryIdentityError) return "Repository identity could not be established. Run shipyard-setup from an existing Git repository and verify its common directory.";
  return error instanceof Error ? error.message : "Shipyard could not safely resolve this command.";
}

/** Backward-compatible setup-scoped mapper for source consumers. */
export function setupGuidance(error: unknown): string { return commandGuidance(error, "setup"); }
