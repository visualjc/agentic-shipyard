import { help } from "../commands/help.js";
import { setup } from "../commands/setup.js";
import { status } from "../commands/status.js";
import { sync } from "../commands/sync.js";
import type { TopologyRequest } from "../profile/policy.js";
import { explicitOptionalOption, optionalOption, parseArguments, requiredOption, requireExactCommandShape } from "./arguments.js";
import { commandGuidance } from "./guidance.js";
import { createRuntime } from "./runtime.js";
import { NodeSyncStatusReader } from "../adapters/sync-status.js";

export type CommandName = "shipyard" | "setup" | "status" | "sync" | "help" | "review";
export async function run(argv: readonly string[], invokedAs: CommandName = "shipyard", cwd = process.cwd()): Promise<{ code: number; output: string }> {
  let activeCommand: string = invokedAs;
  try {
    const parsed = parseArguments(argv);
    const command = invokedAs === "shipyard" ? (parsed.positionals.shift() ?? "help") : invokedAs;
    activeCommand = command;
    if (command === "sync") requireExactCommandShape(parsed, "shipyard-sync", ["home", "repo", "source-ref"]);
    const home = optionalOption(parsed, "home");
    const runtime = createRuntime(home);
    const repositoryPath = optionalOption(parsed, "repo") ?? cwd;
    if (command === "help") return { code: 0, output: `${help(parsed.positionals[0])}\n` };
    if (command === "review") return { code: 0, output: `${help("review")}\n` };
    if (command === "status") return { code: 0, output: `${JSON.stringify(await status(runtime.bindings, runtime.git, runtime.profiles, repositoryPath, new NodeSyncStatusReader(), runtime.graphs), null, 2)}\n` };
    if (command === "sync") return { code: 0, output: `${JSON.stringify(await sync(runtime, repositoryPath, explicitOptionalOption(parsed, "source-ref")), null, 2)}\n` };
    if (command === "setup") {
      const kind = requiredOption(parsed, "topology");
      if (kind !== "staged-pair" && kind !== "single-repository") throw new Error("--topology must be staged-pair or single-repository.");
      const development = { name: requiredOption(parsed, "development-name"), url: requiredOption(parsed, "development-url") };
      const destinationName = optionalOption(parsed, "destination-name");
      const destinationUrl = optionalOption(parsed, "destination-url");
      const topology: TopologyRequest = kind === "staged-pair"
        ? { kind, development, destination: { name: destinationName ?? "", url: destinationUrl ?? "" } }
        : { kind, development };
      const binding = await setup(runtime, { repositoryPath, profile: requiredOption(parsed, "profile"), topology, rebind: parsed.values.get("rebind") === true });
      return { code: 0, output: `Bound ${binding.profileName} to ${binding.commonDirectory}.\n` };
    }
    return { code: 2, output: `${help("shipyard")}\n` };
  } catch (error) {
    return { code: 1, output: `${commandGuidance(error, activeCommand)}\n` };
  }
}
