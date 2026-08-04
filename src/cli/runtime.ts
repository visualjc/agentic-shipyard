import { join } from "node:path";
import { BindingService, JsonBindingStore, nodeFilesystem, nodeGit } from "../index.js";

export type CommandRuntime = Readonly<{ bindings: BindingService; bindingPath: string }>;

/** SHIPYARD_HOME is deliberately local machine state, never repository configuration. */
export function createRuntime(home = process.env.SHIPYARD_HOME ?? join(process.env.HOME ?? ".", ".shipyard")): CommandRuntime {
  const bindingPath = join(home, "bindings.json");
  return { bindingPath, bindings: new BindingService(new JsonBindingStore(nodeFilesystem, bindingPath), nodeGit) };
}
