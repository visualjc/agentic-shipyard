import { help } from "../commands/help.js";
import { setup } from "../commands/setup.js";
import { status } from "../commands/status.js";
import type { RepositoryTopology } from "../index.js";
import { optionalOption, parseArguments, requiredOption } from "./arguments.js";
import { setupGuidance } from "./guidance.js";
import { createRuntime } from "./runtime.js";

export type CommandName = "shipyard" | "setup" | "status" | "help";
export async function run(argv: readonly string[], invokedAs: CommandName = "shipyard", cwd = process.cwd()): Promise<{ code: number; output: string }> {
  try {
    const parsed = parseArguments(argv);
    const command = invokedAs === "shipyard" ? (parsed.positionals.shift() ?? "help") : invokedAs;
    const home = optionalOption(parsed, "home");
    const runtime = createRuntime(home);
    const repositoryPath = optionalOption(parsed, "repo") ?? cwd;
    if (command === "help") return { code: 0, output: `${help(parsed.positionals[0])}\n` };
    if (command === "status") return { code: 0, output: `${JSON.stringify(await status(runtime.bindings, repositoryPath), null, 2)}\n` };
    if (command === "setup") {
      const kind = requiredOption(parsed, "topology");
      if (kind !== "staged-pair" && kind !== "single-repository") throw new Error("--topology must be staged-pair or single-repository.");
      const development = { name: requiredOption(parsed, "development-name"), url: requiredOption(parsed, "development-url") };
      const destinationName = optionalOption(parsed, "destination-name");
      const destinationUrl = optionalOption(parsed, "destination-url");
      const topology: RepositoryTopology = kind === "staged-pair"
        ? { kind, development, destination: { name: destinationName ?? "", url: destinationUrl ?? "" } }
        : { kind, development };
      const binding = await setup(runtime.bindings, { repositoryPath, profile: requiredOption(parsed, "profile"), topology, rebind: parsed.values.get("rebind") === true });
      return { code: 0, output: `Bound ${binding.profile} to ${binding.commonDirectory}.\n` };
    }
    return { code: 2, output: `${help("shipyard")}\n` };
  } catch (error) {
    return { code: 1, output: `${setupGuidance(error)}\n` };
  }
}
