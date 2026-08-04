import { createHash } from "node:crypto";
import { join } from "node:path";
import { nodeFilesystem } from "../adapters/filesystem.js";
import { nodeGit } from "../adapters/git.js";
import { nodeProcess } from "../adapters/process.js";
import { BindingService } from "../binding/service.js";
import { JsonBindingStore } from "../binding/store.js";
import { MutationLockService } from "../locking/mutation-lock.js";
import { GlobalProfileStore } from "./profile-store.js";
import { createGraphLaneService, type GraphLaneController } from "../graph/service.js";

export type CommandRuntime = Readonly<{
  bindings: BindingService;
  bindingPath: string;
  git: typeof nodeGit;
  locks: MutationLockService;
  profiles: GlobalProfileStore;
  graphs: GraphLaneController;
  setupLockPath(commonDirectory: string): string;
  bindingMutationLockPath(): string;
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
    graphs: createGraphLaneService(home),
    setupLockPath: (commonDirectory) => join(home, "locks", `${createHash("sha256").update(commonDirectory).digest("hex")}.lock`),
    bindingMutationLockPath: () => join(home, "locks", "binding-store.lock"),
  };
}
