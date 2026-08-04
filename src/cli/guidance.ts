import { BindingError } from "../index.js";

export function setupGuidance(error: unknown): string {
  if (error instanceof BindingError) {
    switch (error.code) {
      case "repository-unbound": return "No binding was found. Run shipyard-setup with the complete, existing topology.";
      case "binding-duplicate": return "More than one binding matches this repository. Repair the local binding store, then run shipyard-setup --rebind only after verifying the topology.";
      case "binding-stale": return "The existing binding cannot be safely reused. Verify the repository identity and run shipyard-setup --rebind with the complete topology.";
      case "binding-remote-mismatch": return "A configured remote differs from the binding. Shipyard will not rewrite remotes; correct it yourself, then run shipyard-setup --rebind.";
      case "topology-incomplete": return "The topology is incomplete. Provide every required remote name and URL to shipyard-setup.";
      case "topology-invalid": return "The topology is invalid. A staged pair needs distinct existing remotes; a single repository has only development.";
      case "binding-store-invalid": return "The local binding store is invalid. Restore or repair it before running shipyard-setup --rebind.";
    }
  }
  return error instanceof Error ? error.message : "Shipyard could not safely resolve this command.";
}
