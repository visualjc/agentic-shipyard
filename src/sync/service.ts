import type { MutationLockService } from "../locking/mutation-lock.js";
import { classifyProfilePath, PathPolicyError } from "../policy/path-classifier.js";
import { profileFingerprint } from "../profile/fingerprint.js";
import type { BoundProfileAuthorityResolver } from "../profile/bound-authority.js";
import type { ProfileReader } from "../profile/policy.js";
import type { LedgerStore } from "../ledger/types.js";
import { SyncError } from "./errors.js";
import type { BaselineObservation, SyncGit } from "./git.js";
import { canonicalSourceRef, sourceProvenancePath, validateSourceProvenance } from "./provenance.js";
import type { SourceProvenance, SyncOutcome, SyncRequest } from "./types.js";
import type { SyncDestinationTransport, StagedDestination } from "./transport.js";

export { SyncError } from "./errors.js";
export { canonicalSourceRef } from "./provenance.js";

export type SyncDependencies = Readonly<{
  authority: BoundProfileAuthorityResolver;
  profiles: ProfileReader;
  git: SyncGit;
  locks: MutationLockService;
  ledger: LedgerStore;
  transport: SyncDestinationTransport;
  lockPath(commonDirectory: string): string;
  now?: () => Date;
}>;

/** The sole sync mutation coordinator: its operations are fetch/update only. */
export class SyncService {
  constructor(private readonly dependencies: SyncDependencies) {}

  async sync(request: SyncRequest): Promise<SyncOutcome> {
    if (!request.repositoryPath.trim()) throw new SyncError("remote-identity", "Sync requires a repository path.");
    const authority = await this.dependencies.authority.resolve(request.repositoryPath, "sync");
    const profile = await this.dependencies.profiles.read(authority.profileName);
    if (profileFingerprint(profile) !== authority.profileFingerprint) throw new SyncError("remote-identity", "The bound profile changed; rebind after verifying it.");
    const refs = authority.topology.kind === "staged-pair"
      ? { development: authority.topology.development, destination: authority.topology.destination }
      : { development: authority.topology.repository, destination: authority.topology.repository };
    const lock = await this.dependencies.locks.acquire(this.dependencies.lockPath(authority.commonDirectory), authority.commonDirectory, "sync");
    try {
      const lockedAuthority = await this.dependencies.authority.resolve(request.repositoryPath, "sync");
      const lockedProfile = await this.dependencies.profiles.read(lockedAuthority.profileName);
      if (lockedAuthority.commonDirectory !== authority.commonDirectory || lockedAuthority.profileFingerprint !== authority.profileFingerprint || JSON.stringify(lockedAuthority.topology) !== JSON.stringify(authority.topology) || profileFingerprint(lockedProfile) !== authority.profileFingerprint) throw new SyncError("remote-identity", "Binding or profile authority changed while acquiring the sync lock; rerun from fresh status.");
      const staged = await this.dependencies.transport.stage(request.repositoryPath, refs.development.defaultBranch, refs.destination.defaultBranch, request.sourceRef);
      try {
        const observation = await this.dependencies.git.observeStaged(request.repositoryPath, staged.repositoryPath, refs.destination.remote.name, refs.development.defaultBranch);
        this.validateObservation(observation, refs.development.defaultBranch, refs.destination, profile);
        if (request.sourceRef !== undefined) return this.importSource(request, refs.destination.remote.name, refs.destination.remote.url, observation, staged);
        if (observation.ancestry !== "equal" && observation.ancestry !== "behind") throw new SyncError("baseline-diverged", "Development main is not a fast-forward ancestor of destination main; inspect the divergence and rerun only after explicit repair.");
        const importedDestination = await this.dependencies.git.importStaged(request.repositoryPath, staged.repositoryPath, staged.destinationRef, `refs/remotes/${refs.destination.remote.name}/${refs.destination.defaultBranch}`, observation.destinationSha);
        if (importedDestination !== observation.destinationSha) throw new SyncError("observation-changed", "Uncredentialed destination import did not preserve the staged exact object.");
        if (observation.ancestry === "behind") await this.dependencies.git.fastForward(request.repositoryPath, refs.destination.remote.name, refs.destination.defaultBranch, observation.developmentSha, observation.destinationSha);
        const after = await this.dependencies.git.observe(request.repositoryPath, refs.destination.remote.name, refs.development.defaultBranch, refs.destination.defaultBranch);
        if (!after.clean || after.developmentSha !== observation.destinationSha || after.destinationSha !== observation.destinationSha || after.ancestry !== "equal") throw new SyncError("observation-changed", "Git facts changed or the worktree became dirty during fast-forward; inspect state before any new sync.");
        return Object.freeze({ kind: "baseline", destinationSha: observation.destinationSha, nextSafeAction: observation.ancestry === "equal" ? "Baseline is already synchronized." : "Baseline synchronized; create or resume development work separately." });
      } finally { await staged.release(); }
    } finally { await lock.release(); }
  }

  async requireFreshSource(input: unknown, repositoryPath: string): Promise<void> {
    const provenance = validateSourceProvenance(input);
    const authority = await this.dependencies.authority.resolve(repositoryPath, "sync");
    const destination = authority.topology.kind === "staged-pair" ? authority.topology.destination : authority.topology.repository;
    const development = authority.topology.kind === "staged-pair" ? authority.topology.development : authority.topology.repository;
    if (destination.remote.name !== provenance.remoteName || destination.remote.url !== provenance.remoteUrl || canonicalSourceRef(provenance.remoteName, provenance.requestedRef) !== provenance.localRef) throw new SyncError("source-stale", "Recorded source provenance no longer matches the bound destination; import it again explicitly.");
    const staged = await this.dependencies.transport.stage(repositoryPath, development.defaultBranch, destination.defaultBranch, provenance.requestedRef);
    try { const local = await this.dependencies.git.resolveLocal(repositoryPath, provenance.localRef); if (staged.sourceSha !== provenance.sha || local !== provenance.sha) throw new SyncError("source-stale", "The authoritative or local source ref changed; do not use the old imported source ref."); }
    finally { await staged.release(); }
  }

  private validateObservation(observation: BaselineObservation, branch: string, destination: { owner: string; name: string; remote: { name: string; url: string }; defaultBranch: string }, profile: Awaited<ReturnType<ProfileReader["read"]>>): void {
    if (!observation.clean) throw new SyncError("dirty-worktree", "Worktree or index is dirty; clean it and rerun shipyard-sync.");
    if (observation.checkedOutBranch !== branch) throw new SyncError("wrong-branch", `Checked out branch must be ${branch}; switch explicitly and rerun.`);
    if (observation.remoteUrl !== destination.remote.url) throw new SyncError("remote-identity", "Destination remote identity differs from the bound profile; inspect it and rebind if intended.");
    if (observation.ancestry === "ahead" || observation.ancestry === "diverged") throw new SyncError("baseline-diverged", "Development main is ahead or diverged; Shipyard will not rebase, reset, merge, or repair it.");
    if (!fullObjectId(observation.developmentSha, observation.objectFormat) || !fullObjectId(observation.destinationSha, observation.objectFormat)) throw new SyncError("invalid-object-id", "Observed Git object IDs are not full lowercase IDs for this repository format.");
    try { for (const path of observation.changedPaths) classifyProfilePath(profile, path); }
    catch (error) { if (error instanceof PathPolicyError) throw new SyncError("path-policy", `${error.message} Update the profile policy explicitly before rerunning.`); throw error; }
  }

  private async importSource(request: SyncRequest, remote: string, remoteUrl: string, observation: BaselineObservation, staged: StagedDestination): Promise<SyncOutcome> {
    const source = request.sourceRef!;
    if (!safeSourceRef(source)) throw new SyncError("unsafe-source-ref", "Source import requires one explicit safe branch, tag, or full ref; wildcards and refspecs are refused.");
    const localRef = canonicalSourceRef(remote, source);
    if (!staged.sourceRef || !staged.sourceSha) throw new SyncError("observation-changed", "Staged source facts are unavailable.");
    const resolved = await this.dependencies.git.importStaged(request.repositoryPath, staged.repositoryPath, staged.sourceRef, localRef, staged.sourceSha);
    if (!fullObjectId(resolved, observation.objectFormat)) throw new SyncError("invalid-object-id", "Imported source did not resolve to a full canonical object ID.");
    if (staged.sourceSha !== resolved) throw new SyncError("observation-changed", "Source changed while importing; imported ref will not be used.");
    const observedAt = (this.dependencies.now ?? (() => new Date()))().toISOString();
    const path = sourceProvenancePath(remote, source);
    const receiptPath = `sync/source-receipts/${observedAt.replace(/[:.]/g, "-")}-${path.split("/").at(-1)!}`;
    const snapshot = await this.dependencies.ledger.snapshot([path]);
    const receiptHead = await this.dependencies.ledger.transact({ expectedHead: snapshot.head, writes: [{ path: receiptPath, contents: JSON.stringify({ schemaVersion: 1, remoteName: remote, requestedRef: source, sha: resolved, observedAt }) }], message: `Record source import receipt for ${source}` });
    if (!fullObjectId(receiptHead, observation.objectFormat)) throw new SyncError("invalid-object-id", "Ledger receipt did not return a full checkpoint object ID for this repository format.");
    const provenance: SourceProvenance = Object.freeze({ schemaVersion: 1, remoteName: remote, remoteUrl, requestedRef: source, localRef, sha: resolved, objectFormat: observation.objectFormat, observedAt, ledgerCheckpointSha: receiptHead });
    await this.dependencies.ledger.transact({ expectedHead: receiptHead, writes: [{ path, contents: `${JSON.stringify(provenance, null, 2)}\n`, ...(snapshot.records[path] === undefined ? {} : { expectedContents: snapshot.records[path] }) }], message: `Record source provenance for ${source}` });
    return Object.freeze({ kind: "source", provenance, nextSafeAction: "Source imported read-only; verify its provenance again immediately before use." });
  }
}

function safeSourceRef(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/@-]{0,255}$/.test(value) && !value.includes("*") && !value.includes(":") && !value.includes("//") && !value.split("/").some(part => part === "." || part === "..") && !value.startsWith("-") && !value.endsWith("/");
}
function fullObjectId(value: string, format: "sha1" | "sha256"): boolean { return new RegExp(`^[a-f0-9]{${format === "sha1" ? 40 : 64}}$`).test(value); }
