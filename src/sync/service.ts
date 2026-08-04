import type { MutationLockService } from "../locking/mutation-lock.js";
import { classifyProfilePath, PathPolicyError } from "../policy/path-classifier.js";
import { profileFingerprint } from "../profile/fingerprint.js";
import type { BoundProfileAuthorityResolver } from "../profile/bound-authority.js";
import type { ProfileReader } from "../profile/policy.js";
import type { LedgerStore } from "../ledger/types.js";
import type { PinnedLedgerReader } from "../context/types.js";
import { SyncError } from "./errors.js";
import type { BaselineObservation, SyncGit } from "./git.js";
import { canonicalSourceRef, isSafeSourceRef, sourceProvenanceContents, sourceProvenancePath, sourceReceiptContents, sourceReceiptPath, validateSourceProvenance, type SourceReceipt } from "./provenance.js";
import type { SourceProvenance, SyncOutcome, SyncRequest } from "./types.js";
import type { SyncDestinationTransport, StagedDestination } from "./transport.js";

export { SyncError } from "./errors.js";
export { canonicalSourceRef } from "./provenance.js";

export type SyncDependencies = Readonly<{
  authority: BoundProfileAuthorityResolver;
  profiles: ProfileReader;
  git: SyncGit;
  locks: MutationLockService;
  ledger: LedgerStore & PinnedLedgerReader;
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
    if (request.sourceRef !== undefined && !isSafeSourceRef(request.sourceRef)) throw new SyncError("unsafe-source-ref", "Source import requires one explicit safe branch, tag, or full ref; wildcards and refspecs are refused.");
    const initial = await this.dependencies.git.observe(request.repositoryPath, refs.destination.remote.name, refs.development.defaultBranch, refs.destination.defaultBranch);
    this.validateObservation(initial, refs.development.defaultBranch, refs.destination, profile);
    const lock = await this.dependencies.locks.acquire(this.dependencies.lockPath(authority.commonDirectory), authority.commonDirectory, "sync");
    try {
      const lockedAuthority = await this.dependencies.authority.resolve(request.repositoryPath, "sync");
      const lockedProfile = await this.dependencies.profiles.read(lockedAuthority.profileName);
      if (lockedAuthority.commonDirectory !== authority.commonDirectory || lockedAuthority.profileFingerprint !== authority.profileFingerprint || JSON.stringify(lockedAuthority.topology) !== JSON.stringify(authority.topology) || profileFingerprint(lockedProfile) !== authority.profileFingerprint) throw new SyncError("remote-identity", "Binding or profile authority changed while acquiring the sync lock; rerun from fresh status.");
      const lockedLocal = await this.dependencies.git.observe(request.repositoryPath, refs.destination.remote.name, refs.development.defaultBranch, refs.destination.defaultBranch);
      this.validateObservation(lockedLocal, refs.development.defaultBranch, refs.destination, lockedProfile);
      const staged = await this.dependencies.transport.stage(request.repositoryPath, refs.development.defaultBranch, refs.destination.defaultBranch, request.sourceRef);
      try {
        const observation = await this.dependencies.git.observeStaged(request.repositoryPath, staged.repositoryPath, refs.destination.remote.name, refs.development.defaultBranch);
        this.validateObservation(observation, refs.development.defaultBranch, refs.destination, lockedProfile);
        if (request.sourceRef !== undefined) return this.importSource(request, refs.destination.remote.name, refs.destination.remote.url, observation, staged);
        if (observation.ancestry !== "equal" && observation.ancestry !== "behind") throw new SyncError("baseline-diverged", "Development main is not a fast-forward ancestor of destination main; inspect the divergence and rerun only after explicit repair.");
        await this.dependencies.git.materializeStaged(request.repositoryPath, staged.repositoryPath, staged.destinationRef, observation.destinationSha);
        await this.dependencies.git.fastForward(request.repositoryPath, refs.destination.remote.name, refs.development.defaultBranch, refs.destination.defaultBranch, observation.developmentSha, observation.destinationSha);
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
    const provenancePath = sourceProvenancePath(provenance.remoteName, provenance.requestedRef); const receiptPath = sourceReceiptPath(provenance.observedAt, provenance.remoteName, provenance.requestedRef);
    const pinned = await this.dependencies.ledger.read(provenance.ledgerCheckpointSha, [receiptPath]); const durable = await this.dependencies.ledger.snapshot([provenancePath]);
    if (pinned[receiptPath] !== sourceReceiptContents(receiptFrom(provenance)) || durable.records[provenancePath] !== sourceProvenanceContents(provenance)) throw new SyncError("source-stale", "Caller provenance does not match its pinned durable receipt and canonical ledger record.");
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
    const localRef = canonicalSourceRef(remote, source);
    if (!staged.sourceRef || !staged.sourceSha) throw new SyncError("observation-changed", "Staged source facts are unavailable.");
    if (!fullObjectId(staged.sourceSha, observation.objectFormat)) throw new SyncError("invalid-object-id", "Staged source did not resolve to a full object ID for this repository format.");
    const existingSource = await this.dependencies.git.resolveLocalOptional(request.repositoryPath, localRef);
    if (existingSource !== undefined && existingSource !== staged.sourceSha) throw new SyncError("source-stale", "An immutable local source ref already records a different object; its usable provenance was preserved.");
    const observedAt = (this.dependencies.now ?? (() => new Date()))().toISOString();
    const path = sourceProvenancePath(remote, source);
    const receiptPath = sourceReceiptPath(observedAt, remote, source);
    const snapshot = await this.dependencies.ledger.snapshot([path]);
    const receiptDraft: SourceReceipt = Object.freeze({ schemaVersion: 1, remoteName: remote, requestedRef: source, sha: staged.sourceSha, observedAt });
    const receiptHead = await this.dependencies.ledger.transact({ expectedHead: snapshot.head, writes: [{ path: receiptPath, contents: sourceReceiptContents(receiptDraft) }], message: `Record source import receipt for ${source}` });
    if (!fullObjectId(receiptHead, observation.objectFormat)) throw new SyncError("invalid-object-id", "Ledger receipt did not return a full checkpoint object ID for this repository format.");
    const provenance: SourceProvenance = Object.freeze({ schemaVersion: 1, remoteName: remote, remoteUrl, requestedRef: source, localRef, sha: staged.sourceSha, objectFormat: observation.objectFormat, observedAt, ledgerCheckpointSha: receiptHead });
    await this.dependencies.ledger.transact({ expectedHead: receiptHead, writes: [{ path, contents: sourceProvenanceContents(provenance), ...(snapshot.records[path] === undefined ? {} : { expectedContents: snapshot.records[path] }) }], message: `Record source provenance for ${source}` });
    const pinned = await this.dependencies.ledger.read(receiptHead, [receiptPath]); const durable = await this.dependencies.ledger.snapshot([path]);
    if (pinned[receiptPath] !== sourceReceiptContents(receiptDraft) || durable.records[path] !== sourceProvenanceContents(provenance)) throw new SyncError("source-stale", "Durable source provenance verification failed before local ref creation.");
    let resolved = existingSource;
    if (resolved === undefined) {
      try { resolved = await this.dependencies.git.importStaged(request.repositoryPath, staged.repositoryPath, staged.sourceRef, localRef, staged.sourceSha); }
      catch { throw new SyncError("observation-changed", "Source provenance is durable, but local source ref creation failed; rerun the same explicit source import to resume safely."); }
    }
    if (!fullObjectId(resolved, observation.objectFormat) || staged.sourceSha !== resolved) throw new SyncError("observation-changed", "Source import did not preserve its durably recorded exact object.");
    return Object.freeze({ kind: "source", provenance, nextSafeAction: "Source imported read-only; verify its provenance again immediately before use." });
  }
}

function fullObjectId(value: string, format: "sha1" | "sha256"): boolean { return new RegExp(`^[a-f0-9]{${format === "sha1" ? 40 : 64}}$`).test(value); }
function receiptFrom(provenance: SourceProvenance): SourceReceipt { return Object.freeze({ schemaVersion: 1, remoteName: provenance.remoteName, requestedRef: provenance.requestedRef, sha: provenance.sha, observedAt: provenance.observedAt }); }
