import { createHash } from "node:crypto";
import { join } from "node:path";
import { BindingService, JsonBindingStore, MutationLockService, nodeFilesystem, nodeGit, nodeProcess } from "../index.js";
import { GlobalProfileStore } from "./profile-store.js";

export type CommandRuntime = Readonly<{
  bindings: BindingService;
  bindingPath: string;
  git: typeof nodeGit;
  locks: MutationLockService;
  profiles: GlobalProfileStore;
  setupLockPath(commonDirectory: string): string;
}>;

/** SHIPYARD_HOME is deliberately local machine state, never repository configuration. */
export function createRuntime(home = process.env.SHIPYARD_HOME ?? join(process.env.HOME ?? ".", ".shipyard")): CommandRuntime {
  const bindingPath = join(home, "bindings.json");
  return {
    bindingPath,
    bindings: new BindingService(new JsonBindingStore(nodeFilesystem, bindingPath), nodeGit),
    git: nodeGit,
    locks: new MutationLockService(nodeFilesystem, nodeProcess),
    profiles: new GlobalProfileStore(nodeFilesystem, home),
    setupLockPath: (commonDirectory) => join(home, "locks", `${createHash("sha256").update(commonDirectory).digest("hex")}.lock`),
  };
}
