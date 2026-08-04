import { DEFAULT_NODE_GIT_EXECUTABLE, GitTransportCommand, GitTransportCommandRunner, GitTransportCommandResult, nodeGitTransportCommandRunner } from "../adapters/git-transport.js";
import type { BoundProfileAuthorityResolver } from "../profile/bound-authority.js";
import type { GitAdapter } from "../adapters/git.js";

/** Separate from API credentials: this value may be used only in one Git child environment. */
export type GitTransportCredential = { readonly token: string };

export type GitTransportResult = Pick<GitTransportCommandResult, "stdout" | "stderr">;

export class GitTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitTransportError";
  }
}

/**
 * Redact known secret values plus common HTTP credential forms before a
 * diagnostic crosses the transport boundary.
 */
export function redactGitTransportDiagnostic(diagnostic: string, secretValues: readonly string[] = []): string {
  let redacted = diagnostic;
  for (const secret of secretValues) {
    if (secret) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted
    .replace(/(authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, "$1[REDACTED]@");
}

function commandFor(repositoryPath: string, args: readonly string[], credential: GitTransportCredential, expectedUrl: string): GitTransportCommand {
  if (!repositoryPath.trim()) throw new GitTransportError("Git transport requires a repository path.");
  if (!credential.token.trim()) throw new GitTransportError("Git transport credential is unavailable.");
  if (args.some((arg) => arg.includes(credential.token) || /https?:\/\/[^/\s]*@/i.test(arg))) {
    throw new GitTransportError("Git transport refuses credentials in command arguments or remote URLs.");
  }
  assertSafeNetworkCommand(args);
  return {
    executable: DEFAULT_NODE_GIT_EXECUTABLE,
    // The runner resolves this named remote into a disposable Git directory,
    // so no repository/system/global configuration reaches the credentialed
    // child. Its config contains only this remote URL.
    argv: ["-C", repositoryPath, ...args],
    env: {
      // An empty value resets all lower-priority extraheaders before this
      // one scoped authorization header is applied.
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_1: `AUTHORIZATION: bearer ${credential.token}`,
      GIT_TERMINAL_PROMPT: "0",
    },
    isolatedRemote: { repositoryPath, remote: args[1]!, expectedUrl },
  };
}

/** The public transport accepts only the network operations Shipyard needs. */
function assertSafeNetworkCommand(args: readonly string[]): void {
  const [subcommand, remote, ...positionals] = args;
  if ((subcommand !== "fetch" && subcommand !== "ls-remote") || !safeRemote(remote)) {
    throw new GitTransportError("Git transport only permits fetch or ls-remote against a named remote.");
  }
  if (positionals.length > 1 || positionals.some(value => !safeRef(value))) {
    throw new GitTransportError("Git transport refuses Git options and unsafe positional arguments.");
  }
  // Kept explicit for actionable diagnostics if this validation is ever widened.
  if (args.some(value => /(?:^-|config|alias|helper|extraheader)/i.test(value))) {
    throw new GitTransportError("Git transport refuses option, config, alias, helper, and extraheader injection.");
  }
}

function safeRemote(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

function safeRef(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/@-]{0,255}$/.test(value) && !value.includes("//") && !value.endsWith("/");
}

/** Executes an authenticated Git command without changing the active gh identity. */
export class GitTransportService {
  constructor(private readonly authority: BoundProfileAuthorityResolver, private readonly git: GitAdapter, private readonly runner: GitTransportCommandRunner = nodeGitTransportCommandRunner) {}

  /** The only public authenticated operation; remote/URL come from active authority. */
  async run(repositoryPath: string, operation: "fetch" | "ls-remote", ref: string | undefined, credential: GitTransportCredential): Promise<GitTransportResult> {
    const bound = await this.authority.resolve(repositoryPath, "sync");
    const repository = bound.topology.kind === "staged-pair" ? bound.topology.development : bound.topology.repository;
    const actual = await this.git.remoteUrl(repositoryPath, repository.remote.name);
    if (actual !== repository.remote.url || !exactGitHubUrl(actual, repository.owner, repository.name)) throw new GitTransportError("Authenticated Git remote no longer matches the active bound development repository.");
    return this.execute(repositoryPath, ref === undefined ? [operation, repository.remote.name] : [operation, repository.remote.name, ref], credential, repository.remote.url);
  }

  private async execute(repositoryPath: string, args: readonly string[], credential: GitTransportCredential, expectedUrl: string): Promise<GitTransportResult> {
    const result = await this.runner.run(commandFor(repositoryPath, args, credential, expectedUrl));
    const stdout = redactGitTransportDiagnostic(result.stdout, [credential.token]);
    const stderr = redactGitTransportDiagnostic(result.stderr, [credential.token]);
    if (result.exitCode !== 0) {
      const diagnostic = [stderr, stdout].filter(Boolean).join("\n") || "Git exited without a diagnostic.";
      throw new GitTransportError(`Authenticated Git failed (exit ${result.exitCode}): ${diagnostic}`);
    }
    return { stdout, stderr };
  }

}
function exactGitHubUrl(value: string | undefined, owner: string, name: string): boolean { return value === `https://github.com/${owner}/${name}.git` || value === `https://github.com/${owner}/${name}`; }
