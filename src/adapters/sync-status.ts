import { classifyProfilePath } from "../policy/path-classifier.js";
import { sourceProvenanceContents, sourceReceiptContents, sourceReceiptPath, validateSourceProvenance } from "../sync/provenance.js";
import type { SyncStatus, SyncStatusReader, SyncStatusReadRequest } from "../sync/status.js";
import type { SourceProvenance } from "../sync/types.js";
import { createNodeGitTransportCommandRunner, DEFAULT_GIT_COMMAND_MAX_OUTPUT_BYTES, DEFAULT_GIT_COMMAND_TIMEOUT_MS, DEFAULT_NODE_GIT_EXECUTABLE, type GitTransportCommandResult } from "./git-transport.js";
import { NodeSyncGit } from "./sync-git.js";

/** Local-only status facts. No command in this adapter has a remote operation. */
export class NodeSyncStatusReader implements SyncStatusReader {
  private readonly git: NodeSyncGit;
  private readonly runner: ReturnType<typeof createNodeGitTransportCommandRunner>;
  constructor(executable = DEFAULT_NODE_GIT_EXECUTABLE) { this.git = new NodeSyncGit(executable); this.runner = createNodeGitTransportCommandRunner(executable); }

  async read(request: SyncStatusReadRequest): Promise<SyncStatus> {
    let observation;
    try { observation = await this.git.observe(request.repositoryPath, request.destinationRemote, request.developmentBranch, request.destinationBranch); }
    catch { return unavailable("Local baseline facts could not be read safely.", "Inspect the repository and rerun shipyard-status."); }
    let baseline: SyncStatus["baseline"] = observation.ancestry === "equal" && observation.clean && observation.checkedOutBranch === request.developmentBranch && observation.remoteUrl === request.expectedRemoteUrl ? "fresh" : "stale";
    let blocker: SyncStatus["blocker"];
    if (!observation.clean) blocker = blocked("sync-dirty", "Worktree or index is dirty.", "Clean or preserve local changes before synchronization.");
    else if (observation.checkedOutBranch !== request.developmentBranch) blocker = blocked("sync-wrong-branch", "The development default branch is not checked out.", `Switch explicitly to ${request.developmentBranch}.`);
    else if (observation.remoteUrl !== request.expectedRemoteUrl) blocker = blocked("sync-remote-drift", "The destination remote differs from the binding.", "Verify the remote and rebind explicitly if intended.");
    else if (observation.ancestry === "ahead" || observation.ancestry === "diverged") blocker = blocked("sync-diverged", "Development main is ahead or diverged from the local destination tracking ref.", "Inspect the divergence manually; Shipyard will not repair it.");
    try { for (const path of observation.changedPaths) classifyProfilePath(request.profile, path); }
    catch { blocker = blocked("sync-path-policy", "A baseline path is unclassified or ambiguously owned.", "Correct and review the profile path policy before synchronization."); baseline = "stale"; }
    let source: SyncStatus["source"];
    try {
      const sourceFacts = await this.readSources(request);
      source = sourceFacts.source;
      blocker ??= sourceFacts.blocker;
    } catch { blocker ??= blocked("sync-source-unavailable", "Local source provenance could not be validated.", "Run an explicit source import after inspecting local ledger and source refs."); }
    return Object.freeze({ baseline, destinationSha: observation.destinationSha, ...(source ? { source } : {}), ...(blocker ? { blocker } : {}), nextSafeAction: blocker?.nextSafeAction ?? (baseline === "fresh" ? "Local baseline facts are fresh; continue with the next explicit workflow step." : "Run shipyard-sync to refresh the clean fast-forward baseline.") });
  }

  private async readSources(request: SyncStatusReadRequest): Promise<{ source?: SyncStatus["source"]; blocker?: SyncStatus["blocker"] }> {
    const repositoryPath = request.repositoryPath;
    const head = await this.command(repositoryPath, ["rev-parse", "--verify", "--quiet", "refs/heads/shipyard-ledger"]);
    const sourceRefs = await this.command(repositoryPath, ["for-each-ref", "--format=%(refname)", "refs/shipyard/source"]);
    if (sourceRefs.exitCode !== 0) throw new Error("source ref listing unavailable");
    if (head.exitCode !== 0) {
      if (head.exitCode !== 1 || head.stderr !== "Git command failed.") throw new Error("ledger head unavailable");
      return sourceRefs.stdout.trim() ? { blocker: blocked("sync-source-unrecorded", "Local source refs exist without available canonical provenance.", "Inspect the local refs and re-import the exact source explicitly.") } : {};
    }
    const listed = await this.required(repositoryPath, ["ls-tree", "-r", "--name-only", head.stdout.trim(), "--", "sync/source"]);
    const paths = listed.split("\n").filter(Boolean);
    if (paths.length > 128 || paths.some(path => !/^sync\/source\/[A-Za-z0-9._-]+\.json$/.test(path))) throw new Error("unsafe provenance listing");
    if (paths.length === 0) return sourceRefs.stdout.trim() ? { blocker: blocked("sync-source-unrecorded", "Local source refs exist without canonical provenance.", "Inspect the local refs and re-import the exact source explicitly.") } : {};
    const provenances: Array<{ provenance: SourceProvenance; fresh: boolean }> = [];
    for (const path of paths) {
      const bytes = await this.requiredRaw(repositoryPath, ["show", `${head.stdout.trim()}:${path}`]);
      const provenance = validateSourceProvenance(JSON.parse(bytes));
      if (sourceProvenanceContents(provenance) !== bytes) throw new Error("noncanonical provenance bytes");
      const pinned = await this.required(repositoryPath, ["rev-parse", "--verify", `${provenance.ledgerCheckpointSha}^{commit}`]);
      const reachable = await this.command(repositoryPath, ["merge-base", "--is-ancestor", pinned, head.stdout.trim()]);
      if (reachable.exitCode !== 0 && (reachable.exitCode !== 1 || reachable.stderr !== "Git command failed.")) throw new Error("pinned receipt reachability unavailable");
      const receiptPath = sourceReceiptPath(provenance.observedAt, provenance.remoteName, provenance.requestedRef);
      const receipt = reachable.exitCode === 0 ? await this.requiredRaw(repositoryPath, ["show", `${pinned}:${receiptPath}`]) : "";
      const local = await this.git.resolveLocalOptional(repositoryPath, provenance.localRef);
      provenances.push({ provenance, fresh: provenance.remoteName === request.destinationRemote && provenance.remoteUrl === request.expectedRemoteUrl && pinned === provenance.ledgerCheckpointSha && receipt === sourceReceiptContents({ schemaVersion: 1, remoteName: provenance.remoteName, requestedRef: provenance.requestedRef, sha: provenance.sha, observedAt: provenance.observedAt }) && local === provenance.sha });
    }
    provenances.sort((left, right) => right.provenance.observedAt.localeCompare(left.provenance.observedAt));
    const latest = provenances[0]!; const allFresh = provenances.every(value => value.fresh);
    return { source: Object.freeze({ provenance: latest.provenance, fresh: allFresh }), ...(allFresh ? {} : { blocker: blocked("sync-source-stale", "One or more local source refs do not match durable provenance.", "Re-import the exact named source explicitly before use.") }) };
  }

  private command(repositoryPath: string, args: string[]): Promise<GitTransportCommandResult> { return this.runner.run({ executable: DEFAULT_NODE_GIT_EXECUTABLE, argv: ["-C", repositoryPath, ...args], env: {}, timeoutMs: DEFAULT_GIT_COMMAND_TIMEOUT_MS, maxOutputBytes: DEFAULT_GIT_COMMAND_MAX_OUTPUT_BYTES }); }
  private async requiredRaw(repositoryPath: string, args: string[]): Promise<string> { const result = await this.command(repositoryPath, args); if (result.exitCode !== 0) throw new Error("local status Git failed"); return result.stdout; }
  private async required(repositoryPath: string, args: string[]): Promise<string> { return (await this.requiredRaw(repositoryPath, args)).trim(); }
}

function blocked(code: string, message: string, nextSafeAction: string): NonNullable<SyncStatus["blocker"]> { return Object.freeze({ code, message, nextSafeAction }); }
function unavailable(message: string, nextSafeAction: string): SyncStatus { return Object.freeze({ baseline: "unavailable", blocker: blocked("sync-unavailable", message, nextSafeAction), nextSafeAction }); }
