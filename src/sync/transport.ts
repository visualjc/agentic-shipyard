import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_NODE_GIT_EXECUTABLE, type GitTransportCommand, type GitTransportCommandRunner, nodeGitTransportCommandRunner } from "../adapters/git-transport.js";
import type { GitAdapter } from "../adapters/git.js";
import { redactGitTransportDiagnostic } from "../github/git-transport.js";
import type { BoundProfileAuthorityResolver } from "../profile/bound-authority.js";
import { SyncError } from "./errors.js";
import { GitLedgerStore } from "../adapters/ledger-git.js";

export type VerifiedGitTransportCredential = Readonly<{ token: string; verifiedActorLogin: string }>;
export interface GitTransportCredentialResolver { resolve(expectedActorLogin: string): Promise<VerifiedGitTransportCredential | undefined>; }
export type StagedDestination = Readonly<{ repositoryPath: string; destinationRef: string; destinationSha: string; sourceRef?: string; sourceSha?: string; release(): Promise<void> }>;
export interface SyncDestinationTransport { stage(repositoryPath: string, developmentBranch: string, destinationBranch: string, sourceRef?: string): Promise<StagedDestination>; }

/** Credentialed objects terminate in a temporary bare repository. Product Git is never a token-bearing child. */
export class DestinationSyncTransport implements SyncDestinationTransport {
  constructor(private readonly authority: BoundProfileAuthorityResolver, private readonly git: GitAdapter, private readonly credentials: GitTransportCredentialResolver, private readonly runner: GitTransportCommandRunner = nodeGitTransportCommandRunner) {}

  async stage(repositoryPath: string, developmentBranch: string, destinationBranch: string, sourceRef?: string): Promise<StagedDestination> {
    const authority = await this.authority.resolve(repositoryPath, "sync");
    const destination = authority.topology.kind === "staged-pair" ? authority.topology.destination : authority.topology.repository;
    if (await this.git.remoteUrl(repositoryPath, destination.remote.name) !== destination.remote.url || !exactGitHubUrl(destination.remote.url, destination.owner, destination.name)) throw new SyncError("remote-identity", "Bound destination remote changed or does not exactly identify its GitHub repository before authenticated Git.");
    if (!safeBranch(developmentBranch) || !safeBranch(destinationBranch)) throw new SyncError("unsafe-source-ref", "Sync default branches are unsafe.");
    const credential = await this.credentials.resolve(authority.actorLogin);
    if (!credential?.token.trim() || credential.verifiedActorLogin !== authority.actorLogin) throw new SyncError("remote-identity", "A command-scoped Git credential verified for the bound actor is required.");
    const directory = await mkdtemp(join(tmpdir(), "shipyard-sync-stage-"));
    let released = false;
    try {
      const format = await this.local(repositoryPath, ["rev-parse", "--show-object-format"]);
      if (format !== "sha1" && format !== "sha256") throw new SyncError("invalid-object-id", "Product repository object format is unsupported.");
      await this.local(directory, ["init", "--bare", `--object-format=${format}`, directory], false);
      await this.local(directory, ["remote", "add", destination.remote.name, destination.remote.url]);
      await this.local(directory, ["fetch", "--no-tags", repositoryPath, `refs/heads/${developmentBranch}:refs/shipyard/staged-development`]);

      let exactSource: string | undefined;
      if (sourceRef !== undefined) exactSource = await this.resolveExactSource(directory, destination.remote.name, destination.remote.url, sourceRef, credential);
      const destinationRef = "refs/shipyard/staged-destination";
      const fetchArgs = ["-C", directory, "fetch", "--no-tags", destination.remote.name, `refs/heads/${destinationBranch}:${destinationRef}`];
      if (exactSource !== undefined) fetchArgs.push(`${exactSource}:refs/shipyard/staged-source`);
      await this.credentialed({ executable: DEFAULT_NODE_GIT_EXECUTABLE, argv: fetchArgs, env: credentialEnvironment(credential) }, credential);
      const destinationSha = await this.local(directory, ["rev-parse", destinationRef]);
      const sourceSha = exactSource === undefined ? undefined : await this.local(directory, ["rev-parse", "refs/shipyard/staged-source"]);
      return Object.freeze({ repositoryPath: directory, destinationRef, destinationSha, ...(exactSource === undefined ? {} : { sourceRef: "refs/shipyard/staged-source", sourceSha }), release: async () => { if (released) throw new SyncError("observation-changed", "Staged destination was already released."); released = true; await rm(directory, { recursive: true, force: true }); } });
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  }

  private async resolveExactSource(stage: string, remote: string, url: string, input: string, credential: VerifiedGitTransportCredential): Promise<string> {
    if (!safeSourceInput(input)) throw new SyncError("unsafe-source-ref", "Source import requires one explicit safe branch, tag, or full ref.");
    const candidates = input.startsWith("refs/") ? [input] : [`refs/heads/${input}`, `refs/tags/${input}`];
    const result = await this.runCredentialed(stage, ["ls-remote", remote, ...candidates], credential);
    const matches = result.stdout.split("\n").filter(Boolean).map(line => line.split(/\s+/)).filter(parts => parts.length === 2 && candidates.includes(parts[1]!));
    if (matches.length !== 1) throw new SyncError("unsafe-source-ref", "Named source must resolve to exactly one destination branch, tag, or full ref.");
    // The stage config contains only this exact authority URL. Keep it checked at the network seam too.
    if (!exactGitHubUrl(url, new URL(url).pathname.split("/")[1]!, new URL(url).pathname.split("/")[2]!.replace(/\.git$/, ""))) throw new SyncError("remote-identity", "Destination URL changed during source resolution.");
    return matches[0]![1]!;
  }

  private async runCredentialed(stage: string, args: string[], credential: VerifiedGitTransportCredential) { return this.credentialed({ executable: DEFAULT_NODE_GIT_EXECUTABLE, argv: ["-C", stage, ...args], env: credentialEnvironment(credential) }, credential); }
  private async credentialed(command: GitTransportCommand, credential: VerifiedGitTransportCredential) { const result = await this.runner.run(command); if (result.exitCode !== 0) throw new SyncError("observation-changed", `Authenticated destination Git failed: ${redactGitTransportDiagnostic(result.stderr || result.stdout, [credential.token])}`); return { stdout: redactGitTransportDiagnostic(result.stdout, [credential.token]), stderr: redactGitTransportDiagnostic(result.stderr, [credential.token]) }; }
  private async local(repositoryPath: string, args: string[], includeC = true): Promise<string> { const result = await this.runner.run({ executable: DEFAULT_NODE_GIT_EXECUTABLE, argv: includeC ? ["-C", repositoryPath, ...args] : args, env: {} }); if (result.exitCode !== 0) throw new SyncError("observation-changed", `Isolated staging Git failed: ${result.stderr || result.stdout}`); return result.stdout.trim(); }
}

function credentialEnvironment(credential: VerifiedGitTransportCredential): Readonly<Record<string, string>> { return { GIT_CONFIG_COUNT: "3", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "", GIT_CONFIG_KEY_1: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_1: "", GIT_CONFIG_KEY_2: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_2: `AUTHORIZATION: bearer ${credential.token}`, GIT_TERMINAL_PROMPT: "0" }; }
function safeBranch(value: string): boolean { return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(value) && !value.includes("//") && !value.split("/").some(part => part === "." || part === ".."); }
function safeSourceInput(value: string): boolean { return safeBranch(value) && !value.includes(":") && !value.includes("*") && !value.startsWith("-") && !value.endsWith("/"); }
function exactGitHubUrl(value: string, owner: string, name: string): boolean { return value === `https://github.com/${owner}/${name}.git` || value === `https://github.com/${owner}/${name}`; }

export type PublicationRequest = Readonly<{ refspecs: readonly string[]; payload?: unknown }>;
export function requireSourceFreePublication(request: PublicationRequest): void { const serialized = request.payload === undefined ? undefined : JSON.stringify(request.payload); try { GitLedgerStore.requireProductOnlyTransport(request.refspecs, serialized); } catch { throw new SyncError("unsafe-source-ref", "Source refs and other local Shipyard metadata are local-only and cannot appear in product publication refspecs or payloads."); } }
export const assertNoSourcePublication = (refspecs: readonly string[]) => requireSourceFreePublication({ refspecs });
