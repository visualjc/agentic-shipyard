import type { MutationLockService } from "../locking/mutation-lock.js";
import { classifyProfilePath, PathPolicyError } from "../policy/path-classifier.js";
import { profileFingerprint } from "../profile/fingerprint.js";
import type { BoundProfileAuthorityResolver } from "../profile/bound-authority.js";
import type { BoundProfileAuthority } from "../profile/bound-authority.js";
import { requireProfileAuthorization, sameTopology, type ProfileReader } from "../profile/policy.js";
import type { LedgerStore } from "../ledger/types.js";
import type { PinnedLedgerReader } from "../context/types.js";
import { SyncError } from "./errors.js";
import type { BaselineObservation, SyncGit, SyncMutationProof } from "./git.js";
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
    if (request.sourceRef !== undefined && !isSafeSourceRef(request.sourceRef)) throw new SyncError("unsafe-source-ref", "Source import requires one explicit safe branch, tag, or full ref; wildcards and refspecs are refused.");
    const authority = await this.dependencies.authority.resolve(request.repositoryPath, "sync");
    const profile = await this.dependencies.profiles.read(authority.profileName);
    this.validateAuthority(authority, authority, profile);
    const refs = authority.topology.kind === "staged-pair"
      ? { development: authority.topology.development, destination: authority.topology.destination }
      : { development: authority.topology.repository, destination: authority.topology.repository };
    const initial = await this.dependencies.git.observe(request.repositoryPath, refs.destination.remote.name, refs.development.defaultBranch, refs.destination.defaultBranch);
    this.validateObservation(initial, refs.development.defaultBranch, refs.destination, profile);
    const lock = await this.dependencies.locks.acquire(this.dependencies.lockPath(authority.commonDirectory), authority.commonDirectory, "sync");
    try {
      const locked = await this.revalidate(request, authority, refs, initial);
      const lockedLocal = locked.local;
      const staged = await this.dependencies.transport.stage(request.repositoryPath, refs.development.defaultBranch, refs.destination.defaultBranch, request.sourceRef);
      try {
        const postStage = await this.revalidate(request, authority, refs, lockedLocal, staged);
        const observation = postStage.staged!;
        if (request.sourceRef !== undefined) return this.importSource(request, authority, refs, lockedLocal, observation, staged);
        if (observation.ancestry !== "equal" && observation.ancestry !== "behind") throw new SyncError("baseline-diverged", "Development main is not a fast-forward ancestor of destination main; inspect the divergence and rerun only after explicit repair.");
        await this.revalidate(request, authority, refs, lockedLocal, staged, observation);
        const proof = mutationProof(refs, lockedLocal);
        await this.dependencies.git.materializeStaged(request.repositoryPath, staged.repositoryPath, staged.destinationRef, observation.destinationSha, proof);
        await this.revalidate(request, authority, refs, lockedLocal, staged, observation);
        await this.dependencies.git.fastForward(request.repositoryPath, observation.destinationSha, proof);
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

  private async importSource(request: SyncRequest, authority: BoundProfileAuthority, refs: RepositoryPair, lockedLocal: BaselineObservation, observation: BaselineObservation, staged: StagedDestination): Promise<SyncOutcome> {
    const source = request.sourceRef!;
    const remote = refs.destination.remote.name; const remoteUrl = refs.destination.remote.url;
    const localRef = canonicalSourceRef(remote, source);
    if (!staged.sourceRef || !staged.sourceSha) throw new SyncError("observation-changed", "Staged source facts are unavailable.");
    if (!fullObjectId(staged.sourceSha, observation.objectFormat)) throw new SyncError("invalid-object-id", "Staged source did not resolve to a full object ID for this repository format.");
    const existingSource = await this.dependencies.git.resolveLocalOptional(request.repositoryPath, localRef);
    if (existingSource !== undefined && existingSource !== staged.sourceSha) throw new SyncError("source-stale", "An immutable local source ref already records a different object; its usable provenance was preserved.");
    const path = sourceProvenancePath(remote, source);
    const snapshot = await this.dependencies.ledger.snapshot([path]);
    const priorBytes = snapshot.records[path];
    if (priorBytes !== undefined) {
      const prior = this.validateExistingProvenance(priorBytes, remote, remoteUrl, source, localRef, observation.objectFormat);
      if (prior.sha !== staged.sourceSha) throw new SyncError("source-stale", "The authoritative source moved; the last usable canonical provenance was preserved and must not be overwritten.");
      const receiptPath = sourceReceiptPath(prior.observedAt, remote, source);
      const pinned = await this.dependencies.ledger.read(prior.ledgerCheckpointSha, [receiptPath]);
      if (pinned[receiptPath] !== sourceReceiptContents(receiptFrom(prior))) throw new SyncError("source-stale", "Existing source provenance has no matching pinned durable receipt.");
      if (existingSource === undefined) {
        await this.revalidate(request, authority, refs, lockedLocal, staged, observation);
        try { await this.dependencies.git.importStaged(request.repositoryPath, staged.repositoryPath, staged.sourceRef, localRef, staged.sourceSha, mutationProof(refs, lockedLocal)); }
        catch { throw new SyncError("observation-changed", "The same-SHA source resume failed before local ref creation; rerun the identical explicit source import."); }
      }
      return Object.freeze({ kind: "source", provenance: prior, nextSafeAction: "Source import is durably resumed; verify its provenance again immediately before use." });
    }
    await this.revalidate(request, authority, refs, lockedLocal, staged, observation);
    const observedAt = (this.dependencies.now ?? (() => new Date()))().toISOString();
    const receiptPath = sourceReceiptPath(observedAt, remote, source);
    const receiptDraft: SourceReceipt = Object.freeze({ schemaVersion: 1, remoteName: remote, requestedRef: source, sha: staged.sourceSha, observedAt });
    const receiptHead = await this.dependencies.ledger.transact({ expectedHead: snapshot.head, writes: [{ path: receiptPath, contents: sourceReceiptContents(receiptDraft) }], message: `Record source import receipt for ${source}` });
    if (!fullObjectId(receiptHead, observation.objectFormat)) throw new SyncError("invalid-object-id", "Ledger receipt did not return a full checkpoint object ID for this repository format.");
    const provenance: SourceProvenance = Object.freeze({ schemaVersion: 1, remoteName: remote, remoteUrl, requestedRef: source, localRef, sha: staged.sourceSha, objectFormat: observation.objectFormat, observedAt, ledgerCheckpointSha: receiptHead });
    await this.revalidate(request, authority, refs, lockedLocal, staged, observation);
    await this.dependencies.ledger.transact({ expectedHead: receiptHead, writes: [{ path, contents: sourceProvenanceContents(provenance), ...(snapshot.records[path] === undefined ? {} : { expectedContents: snapshot.records[path] }) }], message: `Record source provenance for ${source}` });
    const pinned = await this.dependencies.ledger.read(receiptHead, [receiptPath]); const durable = await this.dependencies.ledger.snapshot([path]);
    if (pinned[receiptPath] !== sourceReceiptContents(receiptDraft) || durable.records[path] !== sourceProvenanceContents(provenance)) throw new SyncError("source-stale", "Durable source provenance verification failed before local ref creation.");
    await this.revalidate(request, authority, refs, lockedLocal, staged, observation);
    let resolved = existingSource;
    if (resolved === undefined) {
      try { resolved = await this.dependencies.git.importStaged(request.repositoryPath, staged.repositoryPath, staged.sourceRef, localRef, staged.sourceSha, mutationProof(refs, lockedLocal)); }
      catch { throw new SyncError("observation-changed", "Source provenance is durable, but local source ref creation failed; rerun the same explicit source import to resume safely."); }
    }
    if (!fullObjectId(resolved, observation.objectFormat) || staged.sourceSha !== resolved) throw new SyncError("observation-changed", "Source import did not preserve its durably recorded exact object.");
    return Object.freeze({ kind: "source", provenance, nextSafeAction: "Source imported read-only; verify its provenance again immediately before use." });
  }

  private async revalidate(request: SyncRequest, expectedAuthority: BoundProfileAuthority, refs: RepositoryPair, expectedLocal: BaselineObservation, staged?: StagedDestination, expectedStaged?: BaselineObservation): Promise<{ local: BaselineObservation; staged?: BaselineObservation }> {
    const authority = await this.dependencies.authority.resolve(request.repositoryPath, "sync");
    const profile = await this.dependencies.profiles.read(authority.profileName);
    this.validateAuthority(authority, expectedAuthority, profile);
    const local = await this.dependencies.git.observe(request.repositoryPath, refs.destination.remote.name, refs.development.defaultBranch, refs.destination.defaultBranch);
    this.validateObservation(local, refs.development.defaultBranch, refs.destination, profile);
    requireSameObservation(local, expectedLocal);
    if (!staged) return { local };
    const stagedObservation = await this.dependencies.git.observeStaged(request.repositoryPath, staged.repositoryPath, refs.destination.remote.name, refs.development.defaultBranch);
    this.validateObservation(stagedObservation, refs.development.defaultBranch, refs.destination, profile);
    if (expectedStaged) requireSameObservation(stagedObservation, expectedStaged);
    return { local, staged: stagedObservation };
  }

  private validateAuthority(current: BoundProfileAuthority, expected: BoundProfileAuthority, profile: Awaited<ReturnType<ProfileReader["read"]>>): void {
    try { requireProfileAuthorization(profile, "sync"); }
    catch { throw new SyncError("remote-identity", "The active profile no longer authorizes synchronization."); }
    if (current.profileName !== expected.profileName || current.commonDirectory !== expected.commonDirectory || current.profileFingerprint !== expected.profileFingerprint || current.actorLogin !== expected.actorLogin || !sameTopology(current.topology, expected.topology) || profile.name !== expected.profileName || profile.actor.login !== expected.actorLogin || profileFingerprint(profile) !== expected.profileFingerprint || !sameTopology(profile.topology, expected.topology)) throw new SyncError("remote-identity", "Binding, profile, actor, operation, or topology authority changed before mutation; rerun from fresh status.");
  }

  private validateExistingProvenance(bytes: string, remote: string, remoteUrl: string, source: string, localRef: string, objectFormat: "sha1" | "sha256"): SourceProvenance {
    let provenance: SourceProvenance;
    try { provenance = validateSourceProvenance(JSON.parse(bytes)); }
    catch { throw new SyncError("source-stale", "Existing canonical source provenance is malformed; it was preserved without overwrite."); }
    if (sourceProvenanceContents(provenance) !== bytes || provenance.remoteName !== remote || provenance.remoteUrl !== remoteUrl || provenance.requestedRef !== source || provenance.localRef !== localRef || provenance.objectFormat !== objectFormat) throw new SyncError("source-stale", "Existing canonical source provenance does not match current authority; it was preserved without overwrite.");
    return provenance;
  }
}

function fullObjectId(value: string, format: "sha1" | "sha256"): boolean { return new RegExp(`^[a-f0-9]{${format === "sha1" ? 40 : 64}}$`).test(value); }
function receiptFrom(provenance: SourceProvenance): SourceReceipt { return Object.freeze({ schemaVersion: 1, remoteName: provenance.remoteName, requestedRef: provenance.requestedRef, sha: provenance.sha, observedAt: provenance.observedAt }); }
type RepositoryPair = Readonly<{ development: { defaultBranch: string }; destination: { owner: string; name: string; remote: { name: string; url: string }; defaultBranch: string } }>;
function mutationProof(refs: RepositoryPair, observation: BaselineObservation): SyncMutationProof { return Object.freeze({ destinationRemote: refs.destination.remote.name, developmentBranch: refs.development.defaultBranch, destinationBranch: refs.destination.defaultBranch, expectedDevelopmentSha: observation.developmentSha, expectedDestinationTrackingSha: observation.destinationSha, expectedRemoteUrl: refs.destination.remote.url, objectFormat: observation.objectFormat }); }
function requireSameObservation(actual: BaselineObservation, expected: BaselineObservation): void {
  if (actual.clean !== expected.clean || actual.checkedOutBranch !== expected.checkedOutBranch || actual.developmentSha !== expected.developmentSha || actual.destinationSha !== expected.destinationSha || actual.ancestry !== expected.ancestry || actual.remoteUrl !== expected.remoteUrl || actual.objectFormat !== expected.objectFormat || actual.changedPaths.length !== expected.changedPaths.length || actual.changedPaths.some((path, index) => path !== expected.changedPaths[index])) throw new SyncError("observation-changed", "Local or staged Git facts changed before mutation; no mutation was permitted.");
}
