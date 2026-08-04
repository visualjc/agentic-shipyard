import { help } from "../commands/help.js";
import { setup } from "../commands/setup.js";
import { status } from "../commands/status.js";
import { sync } from "../commands/sync.js";
import { orchestrate } from "../commands/orchestrate.js";
import { review } from "../commands/review.js";
import { promote } from "../commands/promote.js";
import { finalize } from "../commands/finalize.js";
import type { TopologyRequest } from "../profile/policy.js";
import { explicitOptionalOption, optionalOption, parseArguments, requiredOption, requireExactCommandShape } from "./arguments.js";
import { commandGuidance } from "./guidance.js";
import { createRuntime } from "./runtime.js";
import { NodeSyncStatusReader } from "../adapters/sync-status.js";

export type CommandName = "shipyard" | "setup" | "status" | "sync" | "help" | "orchestrate" | "review" | "promote" | "finalize";
export async function run(argv: readonly string[], invokedAs: CommandName = "shipyard", cwd = process.cwd(), injectedRuntime?: ReturnType<typeof createRuntime>): Promise<{ code: number; output: string }> {
  let activeCommand: string = invokedAs;
  try {
    const parsed = parseArguments(argv);
    const publicSubcommands = new Set(["setup", "status", "sync", "help", "resume", "review", "promote", "finalize"]);
    const implicitRequest = invokedAs === "shipyard" && parsed.positionals.length > 0 && !publicSubcommands.has(parsed.positionals[0]!) ? parsed.positionals.join(" ") : undefined;
    const command = invokedAs === "shipyard" ? (implicitRequest === undefined ? (parsed.positionals.shift() ?? "help") : "orchestrate") : invokedAs;
    if (implicitRequest !== undefined) parsed.positionals.splice(0, parsed.positionals.length);
    activeCommand = command;
    if (command === "sync") requireExactCommandShape(parsed, "shipyard-sync", ["home", "repo", "source-ref"]);
    if (command === "setup") requireExactCommandShape(parsed, "shipyard-setup", ["home", "repo", "profile", "topology", "development-name", "development-url", "destination-name", "destination-url", "rebind"]);
    if (command === "status") requireExactCommandShape(parsed, "shipyard-status", ["home", "repo", "lane"]);
    if (command === "orchestrate") requireExactCommandShape(parsed, "shipyard", []);
    if (command === "resume") {
      if (parsed.values.size > 0) throw new Error(`shipyard resume rejects unknown option --${[...parsed.values.keys()][0]}.`);
      if (parsed.duplicateOptions.length > 0) throw new Error(`shipyard resume rejects duplicate option --${parsed.duplicateOptions[0]}.`);
    }
    if (command === "review") requireExactCommandShape(parsed, "shipyard-review", ["home", "repo", "delivery-id"]);
    if (command === "promote") requireExactCommandShape(parsed, "shipyard-promote", ["home", "repo", "delivery-id", "action"]);
    if (command === "finalize") requireExactCommandShape(parsed, "shipyard-finalize", ["home", "repo", "delivery-id"]);
    const home = optionalOption(parsed, "home");
    const runtime = injectedRuntime ?? createRuntime(home);
    const repositoryPath = optionalOption(parsed, "repo") ?? cwd;
    if (command === "help") return { code: 0, output: `${help(parsed.positionals[0])}\n` };
    if (command === "status") {
      const lane = optionalOption(parsed, "lane") ?? "large";
      if (lane !== "large" && lane !== "small" && lane !== "bug" && lane !== "review-only") throw new Error("--lane must be large, small, bug, or review-only.");
      return { code: 0, output: `${JSON.stringify(await status(runtime.bindings, runtime.git, runtime.profiles, repositoryPath, new NodeSyncStatusReader(), runtime.graphs, runtime.dependencyStatus, lane), null, 2)}\n` };
    }
    if (command === "sync") return { code: 0, output: `${JSON.stringify(await sync(runtime, repositoryPath, explicitOptionalOption(parsed, "source-ref")), null, 2)}\n` };
    if (command === "orchestrate") {
      return { code: 0, output: `${JSON.stringify(await orchestrate(runtime.operations.orchestrate, { repositoryPath, requestText: implicitRequest }), null, 2)}\n` };
    }
    if (command === "resume") {
      if (parsed.positionals.length !== 1) throw new Error("shipyard resume requires exactly one delivery identifier.");
      return { code: 0, output: `${JSON.stringify(await orchestrate(runtime.operations.orchestrate, { repositoryPath, deliveryId: parsed.positionals[0] }), null, 2)}\n` };
    }
    if (command === "review") return { code: 0, output: `${JSON.stringify(await review(runtime.operations.review, { deliveryId: requiredOption(parsed, "delivery-id") }), null, 2)}\n` };
    if (command === "promote") {
      const action = requiredOption(parsed, "action");
      if (action !== "initial" && action !== "revision" && action !== "certify") throw new Error("--action must be initial, revision, or certify.");
      return { code: 0, output: `${JSON.stringify(await promote(runtime.operations.promote, { deliveryId: requiredOption(parsed, "delivery-id"), action }), null, 2)}\n` };
    }
    if (command === "finalize") return { code: 0, output: `${JSON.stringify(await finalize(runtime.operations.finalize, { deliveryId: requiredOption(parsed, "delivery-id") }), null, 2)}\n` };
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
