import type { TrustedAcceptanceGate, TrustedAcceptanceReceipt } from "../acceptance/gate.js";
import type { DeliveryResolver } from "../delivery/resolver.js";
import type { DestinationMergePolicy } from "../finalization/types.js";
import type { OwnedWorkspaceCleanup } from "../finalization/git.js";
import type { FinalizationLedger } from "../finalization/ledger.js";
import { verifyDestinationMerge } from "../finalization/merge-policy.js";
import type { MutationLockService } from "../locking/mutation-lock.js";
import type { BoundProfileAuthority, BoundProfileAuthorityResolver } from "../profile/bound-authority.js";
import { profileFingerprint } from "../profile/fingerprint.js";
import { stableShipyardMarker } from "../github/markers.js";
import { requireProfileAuthorization, sameTopology, type ProfileReader } from "../profile/policy.js";
import { PromotionLedger } from "../promotion/manifest.js";
import type { PromotionEvidencePin, PromotionJournal, PromotionJournalStep } from "../promotion/types.js";
import { SingleRepositoryError } from "./errors.js";
import { exactSingleRepositoryOneShotJournalTuple, SingleRepositoryLedger, singleRepositoryManifestDigest } from "./ledger.js";
import { singleRepositoryPolicyDigest } from "./policy.js";
import type { SingleRepositoryProviderAuthority, SingleRepositoryProviderSession } from "./provider.js";
import { singleRepositoryFinalizationIntentContents, singleRepositoryFinalizationReceiptContents, singleRepositoryManifestContents } from "./schema.js";
import type { SingleRepositoryCertification, SingleRepositoryFinalizationGitAuthority, SingleRepositoryFinalizationGitSession, SingleRepositoryFinalizationIntent, SingleRepositoryFinalizationReceipt, SingleRepositoryManifest, SingleRepositoryProductAuthority, SingleRepositoryPullRequest, SingleRepositoryStatus, SingleRepositoryTrackedIssue } from "./types.js";

export interface SingleRepositoryMergePolicyResolver { resolve(profileName: string): Promise<DestinationMergePolicy>; }
export type TrustedSingleRepositoryFinalizationDependencies = Readonly<{
  repositoryPath: string;
  authority: BoundProfileAuthorityResolver;
  profiles: ProfileReader;
  deliveries: Pick<DeliveryResolver, "resolve">;
  evidence: TrustedAcceptanceGate;
  product: SingleRepositoryProductAuthority;
  git: SingleRepositoryFinalizationGitAuthority;
  provider: SingleRepositoryProviderAuthority;
  ledger: SingleRepositoryLedger;
  journal: PromotionLedger;
  finalSeal: Pick<FinalizationLedger, "durableRecordPaths" | "seal" | "verifyExistingSeal">;
  cleanup: OwnedWorkspaceCleanup;
  mergePolicy: SingleRepositoryMergePolicyResolver;
  locks: MutationLockService;
  lockPath(commonDirectory: string): string;
  now?: () => Date;
}>;

export interface TrustedSingleRepositoryFinalizationOperation { observeAndFinalize(input: Readonly<{ deliveryId: string }>): Promise<SingleRepositoryStatus>; inspectStatus(input: Readonly<{ deliveryId: string }>): Promise<SingleRepositoryStatus>; }
export function createTrustedSingleRepositoryFinalizationOperation(raw: TrustedSingleRepositoryFinalizationDependencies): TrustedSingleRepositoryFinalizationOperation { const dependencies = construction(raw), service = new SingleRepositoryFinalizationService(dependencies); return Object.freeze({ observeAndFinalize: (input: Readonly<{ deliveryId: string }>) => service.run(input), inspectStatus: (input: Readonly<{ deliveryId: string }>) => service.inspect(input) }); }

class SingleRepositoryFinalizationService {
  constructor(private readonly dependencies: TrustedSingleRepositoryFinalizationDependencies) {}

  async run(input: Readonly<{ deliveryId: string }>): Promise<SingleRepositoryStatus> {
    const deliveryId = selection(input), pre = await this.dependencies.authority.resolve(this.dependencies.repositoryPath, "finalize"), lock = await this.dependencies.locks.acquire(this.dependencies.lockPath(pre.commonDirectory), pre.commonDirectory, "single-repository-finalize");
    try {
      // The journal is durable recovery authority.  Read and reject conflicts
      // before opening a mutable provider/Git session or touching a workspace.
      let checkpoint = await this.dependencies.ledger.read(deliveryId); if (!checkpoint.manifest) throw new SingleRepositoryError("invalid-state", "A checkpointed single-repository certification is required before finalization.");
      let manifest = checkpoint.manifest, intent = checkpoint.intent;
      const initialJournal = (await this.dependencies.journal.read(deliveryId)).journal;
      if (!intent && this.hasRecoveryStep(initialJournal)) throw new SingleRepositoryError("checkpoint-conflict", "A finalization recovery checkpoint exists without immutable intent.");
      if (intent) this.requireRecoveryJournal(initialJournal, intent);
      if (intent && this.hasRecoveryStep(initialJournal)) {
        if (pre.topology.kind !== "single-repository" || !exactRepositoryUrl(pre.topology.repository)) throw new SingleRepositoryError("authority-changed", "Single-repository recovery authority no longer names the exact bound repository.");
        this.requireImmutableBinding(manifest, intent, pre.actorLogin, pre.topology.repository);
        const awaiting: SingleRepositoryManifest = { ...manifest, pullRequest: { ...manifest.pullRequest, state: "open", mergeCommitSha: undefined }, phase: "awaiting-human-merge" };
        if (intent.manifestDigest !== singleRepositoryManifestDigest(awaiting)) throw new SingleRepositoryError("checkpoint-conflict", "Immutable finalization intent no longer matches the canonical pre-finalization manifest.");
      }
      if (intent && this.cleanupStarted(initialJournal, intent)) {
        // A delete-started checkpoint may be the only proof surviving a lost
        // cleanup response.  Its exact tuple is sufficient to retry only the
        // owned, idempotent cleanup; do not re-open any live authority.
        if (!this.hasExact(initialJournal, "single-repository-workspace-cleanup-completed", `single-workspace-cleanup:${intent.finalHeadSha}`, intent.finalHeadSha)) {
          await this.dependencies.cleanup.removeOwned({ repositoryPath: this.dependencies.repositoryPath, deliveryId, expectedBranch: manifest.branch, expectedSha: intent.finalHeadSha, expectedCreationToken: manifest.workspace.creationToken, expectedWorktreePath: manifest.workspace.worktreePath });
          await this.journalBare(deliveryId, "single-repository-workspace-cleanup-completed", `single-workspace-cleanup:${intent.finalHeadSha}`, intent.finalHeadSha);
        }
        return this.resumePostCleanup(deliveryId, manifest, intent);
      }
      const scope = await this.scope(deliveryId, pre, intent === undefined);
      const provider = await this.dependencies.provider.open({ actorLogin: scope.authority.actorLogin, repository: scope.authority.topology.repository });
      if (!intent) {
        const created = await this.createIntent(scope, manifest, provider); intent = created.intent;
        const intentGit = await this.openGit(scope, manifest, intent);
        try { await this.revalidateFull(scope, manifest, intent, provider, intentGit); await this.dependencies.ledger.writeIntent(checkpoint, intent); checkpoint = await this.dependencies.ledger.read(deliveryId);
          await this.revalidateFull(scope, manifest, intent, provider, intentGit); manifest = freeze({ ...manifest, pullRequest: created.pullRequest, phase: "finalizing" as const }); await this.dependencies.ledger.writeManifest(checkpoint, manifest);
          await this.journalFull(scope, manifest, intent, provider, "final-intent-recorded", `single-final-intent:${intent.mergeCommitSha}`, intent.mergeCommitSha, undefined, intentGit); checkpoint = await this.dependencies.ledger.read(deliveryId);
        } finally { await intentGit.release(); }
      }
      else if (manifest.phase === "awaiting-human-merge") { const intentGit = await this.openGit(scope, manifest, intent); try { await this.revalidateFull(scope, manifest, intent, provider, intentGit); manifest = freeze({ ...manifest, pullRequest: { ...manifest.pullRequest, state: "merged" as const, mergeCommitSha: intent.mergeCommitSha }, phase: "finalizing" as const }); await this.dependencies.ledger.writeManifest(checkpoint, manifest); await this.journalFull(scope, manifest, intent, provider, "final-intent-recorded", `single-final-intent:${intent.mergeCommitSha}`, intent.mergeCommitSha, undefined, intentGit); checkpoint = await this.dependencies.ledger.read(deliveryId); } finally { await intentGit.release(); } }
      else manifest = checkpoint.manifest;
      this.requireIntent(scope, manifest, intent);
      await this.revalidateCheckpoint(scope, manifest, intent);
      const git = await this.openGit(scope, manifest, intent);
      let crossedDeletionMarker = false;
      try {
        verifyDestinationMerge(intent.mergePolicy, { finalDestinationCommitSha: intent.finalHeadSha, finalDestinationTreeSha: intent.finalHeadTreeSha, destinationMergeSha: intent.mergeCommitSha, destinationMainSha: intent.mainSha }, git.observation);
        const journal = (await this.dependencies.journal.read(deliveryId)).journal;
        this.requireRecoveryJournal(journal, intent);
        const branchMissing = await this.verifyResumeAuthority(scope, manifest, intent, journal, git, provider);
        crossedDeletionMarker = await this.execute(scope, manifest, intent, git, provider, branchMissing);
      } finally { await git.release(); }
      if (crossedDeletionMarker) return this.resumePostCleanup(deliveryId, manifest, intent);
      throw new SingleRepositoryError("checkpoint-conflict", "Finalization did not reach its durable deletion recovery seam.");
    } finally { await lock.release(); }
  }

  /** Read-only projection for orchestration. It never acquires the mutation
   * lock, opens finalization Git, or invokes a mutable provider capability. */
  async inspect(input: Readonly<{ deliveryId: string }>): Promise<SingleRepositoryStatus> {
    const deliveryId = selection(input); let checkpoint: Awaited<ReturnType<SingleRepositoryLedger["read"]>>;
    try { checkpoint = await this.dependencies.ledger.read(deliveryId); } catch { throw new SingleRepositoryError("checkpoint-conflict", "Single-repository checkpoint cannot be read safely."); }
    if (!checkpoint.manifest) throw new SingleRepositoryError("checkpoint-conflict", "A checkpointed single-repository certification is required before status inspection.");
    const manifest = checkpoint.manifest, last = manifest.certifications.at(-1)!;
    const pre = await this.dependencies.authority.resolve(this.dependencies.repositoryPath, "finalize"), profile = await this.dependencies.profiles.read(pre.profileName);
    if (pre.topology.kind !== "single-repository" || profile.name !== pre.profileName || profile.actor.login !== pre.actorLogin || profileFingerprint(profile) !== pre.profileFingerprint || !sameTopology(profile.topology, pre.topology) || !exactRepositoryUrl(pre.topology.repository)) throw new SingleRepositoryError("authority-changed", "Single-repository status authority changed.");
    try { requireProfileAuthorization(profile, "finalize"); } catch { throw new SingleRepositoryError("authority-changed", "Profile no longer authorizes single-repository finalization status."); }
    const scope = await this.scope(deliveryId, pre, false);
    const status = (code: string, message: string, nextSafeAction: string, pull = manifest.pullRequest): SingleRepositoryStatus => freeze({ phase: manifest.phase === "complete" ? "finalizing" : manifest.phase, deliveryId, headSha: last.headSha, pullRequest: { number: pull.number, url: pull.url, state: pull.state, draft: pull.draft }, blockers: Object.freeze([{ code, message }]), nextSafeAction });
    // Once deletion intent is durable, cleanup may already have removed the
    // worktree. Read the journal before touching workspace authority.
    let statusJournal: PromotionJournal | undefined;
    try { statusJournal = (await this.dependencies.journal.read(deliveryId)).journal; }
    catch (error) {
      if (error instanceof SingleRepositoryError || (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "checkpoint-conflict")) throw new SingleRepositoryError("checkpoint-conflict", "Finalization journal is malformed or non-canonical.");
      if (manifest.phase === "complete" || manifest.phase === "finalizing") return status("finalization-incomplete", "Finalization journal could not be read safely.", "Resume finalization to verify durable recovery records.");
    }
    const deletionStarted = statusJournal !== undefined && exactJournal(statusJournal, "single-repository-branch-delete-started", `single-branch-delete-started:${last.headSha}`, last.headSha);
    if (checkpoint.intent && statusJournal) this.requireRecoveryJournal(statusJournal, checkpoint.intent);
    // A complete manifest and every post-delete-started recovery seam use only
    // immutable records and a scoped remote observer.
    if (manifest.phase === "complete" || deletionStarted) return this.inspectPostCleanup(scope, manifest, checkpoint, status, statusJournal);
    const receipt = await this.dependencies.evidence.evaluateReceipt();
    if (!receipt.decision.promotionEligible || receipt.deliveryId !== deliveryId || receipt.actorLogin !== scope.authority.actorLogin || !sameEvidence(last.evidence, receipt)) return status("evidence-stale", "Acceptance or independent-review evidence is no longer eligible for this certified head.", "Renew acceptance and independent review, then recertify the exact PR head.");
    const workspaceScope = await this.scope(deliveryId, pre, true);
    if (!workspaceScope.workspace || !sameWorkspace(manifest.workspace, workspaceScope.workspace)) throw new SingleRepositoryError("authority-changed", "Delivery workspace instance no longer matches single-repository authority.");
    const inspectionScope = workspaceScope;
    let product; try { product = await this.dependencies.product.observe({ repositoryPath: inspectionScope.worktreePath!, branch: manifest.branch, expectedHeadSha: last.headSha, expectedBaseSha: last.baseSha }); } catch (error) { if (error instanceof SingleRepositoryError && (error.code === "authority-changed" || error.code === "invalid-state" || error.code === "checkpoint-conflict")) throw error; return status("path-policy", "The exact product observation could not be reproduced safely.", "Inspect the exact product worktree, then recertify before finalization."); }
    if (product.headSha !== last.headSha || product.baseSha !== last.baseSha || product.headTreeSha !== last.headTreeSha || singleRepositoryPolicyDigest(inspectionScope.profile, product) !== last.policyDigest) return status("path-policy", "The observed product tree or path-policy classification drifted from certification.", "Inspect and reclassify the exact product head, then recertify it.");
    let pull: SingleRepositoryPullRequest; try { const provider = await this.dependencies.provider.open({ actorLogin: inspectionScope.authority.actorLogin, repository: inspectionScope.authority.topology.repository }); pull = await provider.observeExistingPullRequest({ deliveryId, resumeNumber: manifest.pullRequest.number }); } catch (error) { if (error instanceof SingleRepositoryError && (error.code === "authority-changed" || error.code === "invalid-state" || error.code === "checkpoint-conflict")) throw error; return status("provider-mismatch", "The canonical pull request could not be observed safely.", "Inspect the provider record and recertify the exact head."); }
    if (pull.id !== manifest.pullRequest.id || pull.number !== manifest.pullRequest.number || pull.url !== manifest.pullRequest.url || pull.headSha !== last.headSha || pull.baseSha !== last.baseSha || pull.headRef !== manifest.branch || pull.baseRef !== manifest.repository.defaultBranch || pull.dossierDigest !== last.dossierDigest) return status("provider-mismatch", "The canonical pull request identity, head, base, or dossier no longer matches certification.", "Inspect the canonical pull request and recertify the exact head.", pull);
    if (pull.state === "closed") return status("closed-unmerged", "The tracked pull request closed without the required observed merge.", "Reopen or replace the pull request through the human workflow, then recertify.", pull);
    if (pull.state === "open") return status("human-merge-required", "The certified pull request is awaiting an authorized human/team merge.", "Wait for and check the authorized human/team merge before finalization.", pull);
    return status("finalization-incomplete", "Finalization is still awaiting its durable post-cleanup completion proof.", "Resume finalization to record, seal, and publish the exact final receipt.", pull);
  }

  private async inspectPostCleanup(scope: Scope, manifest: SingleRepositoryManifest, checkpoint: Awaited<ReturnType<SingleRepositoryLedger["read"]>>, blocked: (code: string, message: string, action: string) => SingleRepositoryStatus, preReadJournal?: PromotionJournal): Promise<SingleRepositoryStatus> {
    const intent = checkpoint.intent, receipt = checkpoint.receipt, last = manifest.certifications.at(-1)!;
    if (!intent || !receipt) return blocked("finalization-incomplete", "Finalization receipt or immutable intent is missing.", "Resume finalization to record and seal the exact final receipt.");
    try { this.requireIntent(scope, manifest, intent); this.requireFinalReceipt(receipt, intent); } catch { return blocked("finalization-incomplete", "Finalization intent or receipt no longer proves this exact delivery.", "Resume finalization from a compatible durable checkpoint."); }
    if (!preReadJournal) return blocked("finalization-incomplete", "Finalization journal could not be read safely.", "Resume finalization to verify durable recovery records.");
    const journal = preReadJournal;
    this.requireRecoveryJournal(journal, intent);
    const proofs: readonly [PromotionJournalStep, string, string][] = [["single-repository-branch-delete-started", `single-branch-delete-started:${intent.finalHeadSha}`, intent.finalHeadSha], ["single-repository-branch-deleted", `single-branch:${intent.finalHeadSha}`, intent.finalHeadSha], ["final-receipt-recorded", `single-final-receipt:${intent.manifestDigest}`, intent.mainSha]];
    if (!proofs.every(([step, key, sha]) => exactJournal(journal, step, key, sha))) return blocked("finalization-incomplete", "Exact deletion or final-receipt recovery proof is missing.", "Resume finalization to repair the durable recovery checkpoints.");
    let seal: string | undefined;
    try { seal = await this.dependencies.finalSeal.verifyExistingSeal(scope.deliveryId, last.headSha); } catch (error) { if (error instanceof SingleRepositoryError || (typeof error === "object" && error !== null && ["checkpoint-conflict", "ledger-invalid-record"].includes(String((error as { code?: unknown }).code)))) throw new SingleRepositoryError("checkpoint-conflict", "Existing final seal is cryptographically invalid."); return blocked("finalization-incomplete", "The local final seal could not be verified.", "Resume finalization to repair the final seal safely."); }
    if (!seal) return blocked("finalization-incomplete", "The local final seal is missing.", "Resume finalization to create and publish the final seal.");
    try {
      const observed = await this.dependencies.git.observeFinalizationStatus({ repositoryPath: this.dependencies.repositoryPath, actorLogin: scope.authority.actorLogin, repository: scope.authority.topology.repository, deliveryBranch: manifest.branch, mergeCommitSha: intent.mergeCommitSha });
      if (observed.deliveryBranchSha !== undefined) throw new SingleRepositoryError("unsafe-recovery", "Deleted delivery branch was recreated.");
      if (observed.ledgerSha !== seal || !observed.mergeReachableFromMain) return blocked("finalization-incomplete", "The exact seal is unpublished or the pinned merge is not reachable from current main.", "Resume finalization to verify publication and merge reachability.");
    } catch (error) { if (error instanceof SingleRepositoryError && (error.code === "authority-changed" || error.code === "invalid-state" || error.code === "checkpoint-conflict" || error.code === "unsafe-recovery")) throw error; return blocked("finalization-incomplete", "Remote finalization status could not be observed safely.", "Resume finalization to verify publication and merge reachability."); }
    return freeze({ phase: "complete", deliveryId: scope.deliveryId, headSha: last.headSha, pullRequest: { number: manifest.pullRequest.number, url: manifest.pullRequest.url, state: "merged", draft: manifest.pullRequest.draft }, sealSha: seal, blockers: Object.freeze([]), nextSafeAction: "Retain the reviewed tag and sealed ledger." });
  }

  private async createIntent(scope: Scope, manifest: SingleRepositoryManifest, provider: SingleRepositoryProviderSession): Promise<Readonly<{ intent: SingleRepositoryFinalizationIntent; pullRequest: SingleRepositoryPullRequest }>> {
    if (manifest.phase !== "awaiting-human-merge") throw new SingleRepositoryError("human-merge-required", "Finalization requires a certified pull request awaiting human/team merge.");
    const last = manifest.certifications.at(-1)!, receipt = await this.dependencies.evidence.evaluateReceipt(); this.requireReceipt(scope, last, receipt);
    const product = await this.dependencies.product.observe({ repositoryPath: scope.worktreePath!, branch: manifest.branch, expectedHeadSha: last.headSha, expectedBaseSha: last.baseSha }); if (product.baseSha !== last.baseSha || product.headTreeSha !== last.headTreeSha || singleRepositoryPolicyDigest(scope.profile, product) !== last.policyDigest) throw new SingleRepositoryError("path-policy", "Current exact PR-head tree no longer matches its certification policy receipt.");
    const pull = await provider.observeExistingPullRequest({ deliveryId: scope.deliveryId, resumeNumber: manifest.pullRequest.number }); this.requireMergedPull(pull, manifest.pullRequest, { finalHeadSha: last.headSha, mergeCommitSha: pull.mergeCommitSha } as SingleRepositoryFinalizationIntent);
    const trackedIssue = manifest.trackedIssue; if (trackedIssue) this.requireIssue(await provider.observeTrackedIssue(scope.deliveryId), trackedIssue);
    const policy = await this.dependencies.mergePolicy.resolve(scope.authority.profileName), git = await this.dependencies.git.open({ repositoryPath: this.dependencies.repositoryPath, actorLogin: scope.authority.actorLogin, repository: scope.authority.topology.repository, deliveryBranch: manifest.branch, expectedMergeSha: pull.mergeCommitSha!, expectedFinalHeadSha: last.headSha });
    try {
      verifyDestinationMerge(policy, { finalDestinationCommitSha: last.headSha, finalDestinationTreeSha: last.headTreeSha, destinationMergeSha: pull.mergeCommitSha!, destinationMainSha: git.observation.destinationMainSha }, git.observation);
      if (git.observation.developmentBranchSha !== last.headSha) throw new SingleRepositoryError("unsafe-recovery", "Delivery branch no longer names the certified exact head before finalization intent.");
      return freeze({ pullRequest: pull, intent: { schemaVersion: 1, deliveryId: scope.deliveryId, manifestDigest: singleRepositoryManifestDigest(manifest), actorLogin: scope.authority.actorLogin, mergePolicy: policy, finalHeadSha: last.headSha, finalHeadTreeSha: last.headTreeSha, mergeCommitSha: pull.mergeCommitSha!, mainSha: git.observation.destinationMainSha, localMainBeforeSha: git.observation.developmentMainSha, reviewedTag: `shipyard/reviewed/${scope.deliveryId}`, ...(trackedIssue ? { trackedIssue } : {}), createdAt: this.now() } });
    } finally { await git.release(); }
  }

  private async openGit(scope: Scope, manifest: SingleRepositoryManifest, intent: SingleRepositoryFinalizationIntent): Promise<SingleRepositoryFinalizationGitSession> { return this.dependencies.git.open({ repositoryPath: this.dependencies.repositoryPath, actorLogin: scope.authority.actorLogin, repository: scope.authority.topology.repository, deliveryBranch: manifest.branch, expectedMergeSha: intent.mergeCommitSha, expectedFinalHeadSha: intent.finalHeadSha }); }

  private async execute(scope: Scope, manifest: SingleRepositoryManifest, intent: SingleRepositoryFinalizationIntent, git: SingleRepositoryFinalizationGitSession, provider: SingleRepositoryProviderSession, branchMissing: boolean): Promise<boolean> {
    if (!branchMissing) {
      await this.revalidateFull(scope, manifest, intent, provider, git); const tag = await git.ensureReviewedTag(intent.reviewedTag, intent.finalHeadSha, `Reviewed ${scope.deliveryId}; single-repository manifest ${intent.manifestDigest}`); await this.journalFull(scope, manifest, intent, provider, "reviewed-tag-published", `single-reviewed-tag:${intent.reviewedTag}`, tag, undefined, git);
      await this.revalidateFull(scope, manifest, intent, provider, git); await git.synchronizeLocalMain(intent.localMainBeforeSha, intent.mainSha); await this.journalFull(scope, manifest, intent, provider, "development-main-synchronized", `single-main:${intent.mainSha}`, intent.mainSha, undefined, git);
      if (intent.trackedIssue) { await this.revalidateFull(scope, manifest, intent, provider, git); await provider.closeTrackedIssue(intent.trackedIssue); await this.journalFull(scope, manifest, intent, provider, "single-repository-issue-closed", `single-issue:${intent.trackedIssue.id}`, undefined, intent.trackedIssue.id, git); }
      await this.journalFull(scope, manifest, intent, provider, "single-repository-workspace-cleanup-started", `single-workspace-cleanup-started:${intent.finalHeadSha}`, intent.finalHeadSha, undefined, git);
      await this.dependencies.cleanup.removeOwned({ repositoryPath: this.dependencies.repositoryPath, deliveryId: scope.deliveryId, expectedBranch: manifest.branch, expectedSha: intent.finalHeadSha, expectedCreationToken: manifest.workspace.creationToken, expectedWorktreePath: manifest.workspace.worktreePath });
      await this.journalBare(scope.deliveryId, "single-repository-workspace-cleanup-completed", `single-workspace-cleanup:${intent.finalHeadSha}`, intent.finalHeadSha);
      await this.journalBare(scope.deliveryId, "single-repository-branch-delete-started", `single-branch-delete-started:${intent.finalHeadSha}`, intent.finalHeadSha);
      // The exact durable tuple is the lease for the irreversible action, but
      // the broad session must be released before that action is attempted.
      const deletionJournal = (await this.dependencies.journal.read(scope.deliveryId)).journal;
      if (!exactJournal(deletionJournal, "single-repository-branch-delete-started", `single-branch-delete-started:${intent.finalHeadSha}`, intent.finalHeadSha)) throw new SingleRepositoryError("checkpoint-conflict", "Exact delivery-branch deletion intent was not durably recorded.");
      return true;
    }
    await this.journalBare(scope.deliveryId, "single-repository-branch-deleted", `single-branch:${intent.finalHeadSha}`, intent.finalHeadSha);
    return true;
  }

  private async verifyResumeAuthority(scope: Scope, manifest: SingleRepositoryManifest, intent: SingleRepositoryFinalizationIntent, journal: PromotionJournal, git: SingleRepositoryFinalizationGitSession, provider: SingleRepositoryProviderSession): Promise<boolean> {
    this.requireRecoveryJournal(journal, intent);
    const started = exactJournal(journal, "single-repository-branch-delete-started", `single-branch-delete-started:${intent.finalHeadSha}`, intent.finalHeadSha) || exactJournal(journal, "single-repository-branch-deleted", `single-branch:${intent.finalHeadSha}`, intent.finalHeadSha), deleted = exactJournal(journal, "single-repository-branch-deleted", `single-branch:${intent.finalHeadSha}`, intent.finalHeadSha), branchSha = git.observation.developmentBranchSha;
    if (deleted && branchSha !== undefined) throw new SingleRepositoryError("unsafe-recovery", "Checkpointed deleted delivery branch was recreated.");
    if (branchSha === undefined) { if (!started) throw new SingleRepositoryError("unsafe-recovery", "Delivery branch disappeared without a durable deletion-intent checkpoint."); await this.revalidateReduced(scope, manifest, intent, provider, ["single-repository-branch-delete-started"], git); return true; }
    if (branchSha !== intent.finalHeadSha) throw new SingleRepositoryError("unsafe-recovery", "Delivery branch changed before checkpointed cleanup.");
    await this.revalidateFull(scope, manifest, intent, provider, git); return false;
  }

  private async scope(deliveryId: string, expected: BoundProfileAuthority, requireWorkspace: boolean): Promise<Scope> {
    const authority = await this.dependencies.authority.resolve(this.dependencies.repositoryPath, "finalize"), profile = await this.dependencies.profiles.read(authority.profileName); if (authority.topology.kind !== "single-repository" || authority.commonDirectory !== expected.commonDirectory || profile.name !== authority.profileName || profile.actor.login !== authority.actorLogin || profileFingerprint(profile) !== authority.profileFingerprint || !sameTopology(profile.topology, authority.topology)) throw new SingleRepositoryError("authority-changed", "Finalization binding, actor, profile, or topology changed.");
    try { requireProfileAuthorization(profile, "finalize"); } catch { throw new SingleRepositoryError("authority-changed", "Profile no longer authorizes single-repository finalization."); }
    if (!exactRepositoryUrl(authority.topology.repository)) throw new SingleRepositoryError("authority-changed", "Single-repository Git remote no longer matches the bound GitHub repository.");
    let workspace: SingleRepositoryManifest["workspace"] | undefined; if (requireWorkspace) { const resolved = await this.dependencies.deliveries.resolve({ repositoryPath: this.dependencies.repositoryPath, deliveryId }); if (resolved.binding.commonDirectory !== authority.commonDirectory || resolved.workspace.branch !== `shipyard/${deliveryId}`) throw new SingleRepositoryError("authority-changed", "Delivery workspace no longer matches single-repository authority."); workspace = freeze({ creationToken: resolved.workspace.creationToken, commonDirectory: resolved.workspace.commonDirectory, worktreePath: resolved.workspace.worktreePath }); }
    return freeze({ deliveryId, authority: authority as Scope["authority"], profile, ...(workspace ? { workspace, worktreePath: workspace.worktreePath } : {}) });
  }

  private async revalidateFull(scope: Scope, manifest: SingleRepositoryManifest, intent: SingleRepositoryFinalizationIntent, provider: SingleRepositoryProviderSession, git?: SingleRepositoryFinalizationGitSession): Promise<void> {
    await this.revalidateAuthority(scope); await this.revalidateCheckpoint(scope, manifest, intent);
    const receipt = await this.dependencies.evidence.evaluateReceipt(), last = manifest.certifications.at(-1)!; this.requireReceipt(scope, last, receipt);
    const resolved = await this.dependencies.deliveries.resolve({ repositoryPath: this.dependencies.repositoryPath, deliveryId: scope.deliveryId });
    if (resolved.binding.profileName !== scope.authority.profileName || resolved.binding.commonDirectory !== scope.authority.commonDirectory || resolved.binding.profileFingerprint !== scope.authority.profileFingerprint || !sameTopology(resolved.binding.topology, scope.authority.topology) || resolved.workspace.branch !== manifest.branch || resolved.workspace.creationToken !== manifest.workspace.creationToken || resolved.workspace.commonDirectory !== manifest.workspace.commonDirectory || resolved.workspace.worktreePath !== manifest.workspace.worktreePath) throw new SingleRepositoryError("authority-changed", "Delivery workspace instance no longer matches finalization authority.");
    const product = await this.dependencies.product.observe({ repositoryPath: resolved.workspace.worktreePath, branch: manifest.branch, expectedHeadSha: last.headSha, expectedBaseSha: last.baseSha });
    if (product.baseSha !== last.baseSha || product.headSha !== last.headSha || product.headTreeSha !== last.headTreeSha || singleRepositoryPolicyDigest(scope.profile, product) !== last.policyDigest) throw new SingleRepositoryError("path-policy", "Current exact PR-head tree or path policy changed before finalization mutation.");
    await this.revalidateProvider(scope, manifest, intent, provider, false);
    if (git && (await git.observeMainSha() !== intent.mainSha || await git.observeDeliveryBranchSha(manifest.branch) !== intent.finalHeadSha)) throw new SingleRepositoryError("unsafe-recovery", "Live main or delivery branch changed before finalization mutation.");
    // This must be the last awaited check before the caller's mutation.
    await this.revalidateAuthority(scope);
  }

  private async revalidateReduced(scope: Scope, manifest: SingleRepositoryManifest, intent: SingleRepositoryFinalizationIntent, provider: SingleRepositoryProviderSession, requiredJournalSteps: readonly PromotionJournalStep[], git?: SingleRepositoryFinalizationGitSession): Promise<void> {
    await this.revalidateAuthority(scope); await this.revalidateCheckpoint(scope, manifest, intent);
    const receipt = await this.dependencies.evidence.evaluateReceipt(), last = manifest.certifications.at(-1)!; this.requireReceipt(scope, last, receipt);
    await this.revalidateProvider(scope, manifest, intent, provider, true);
    const journal = (await this.dependencies.journal.read(scope.deliveryId)).journal;
    for (const step of requiredJournalSteps) {
      const expected = step === "single-repository-branch-delete-started" ? [`single-branch-delete-started:${intent.finalHeadSha}`, intent.finalHeadSha] : step === "single-repository-branch-deleted" ? [`single-branch:${intent.finalHeadSha}`, intent.finalHeadSha] : step === "final-receipt-recorded" ? [`single-final-receipt:${intent.manifestDigest}`, intent.mainSha] : undefined;
      if (!expected || !exactJournal(journal, step, expected[0], expected[1])) throw new SingleRepositoryError("checkpoint-conflict", "Required durable single-repository recovery checkpoint is missing, duplicated, or conflicts with its exact proof.");
    }
    if (git) {
      if (await git.observeMainSha() !== intent.mainSha) throw new SingleRepositoryError("unsafe-recovery", "Repository main changed during finalization recovery validation.");
      if (await git.observeDeliveryBranchSha(manifest.branch) !== undefined) throw new SingleRepositoryError("unsafe-recovery", "Delivery branch was recreated during reduced recovery validation.");
    }
    // Re-resolve all profile/root/topology authority after the final network/journal read.
    await this.revalidateAuthority(scope);
  }

  private async revalidateAuthority(scope: Scope): Promise<void> {
    const current = await this.dependencies.authority.resolve(this.dependencies.repositoryPath, "finalize"), profile = await this.dependencies.profiles.read(current.profileName);
    if (current.topology.kind !== "single-repository" || current.profileName !== scope.authority.profileName || current.commonDirectory !== scope.authority.commonDirectory || current.profileFingerprint !== scope.authority.profileFingerprint || current.actorLogin !== scope.authority.actorLogin || !sameTopology(current.topology, scope.authority.topology) || profile.name !== current.profileName || profile.actor.login !== current.actorLogin || profileFingerprint(profile) !== current.profileFingerprint || !sameTopology(profile.topology, current.topology) || !exactRepositoryUrl(current.topology.repository)) throw new SingleRepositoryError("authority-changed", "Single-repository finalization authority changed before mutation.");
    try { requireProfileAuthorization(profile, "finalize"); } catch { throw new SingleRepositoryError("authority-changed", "Profile no longer authorizes single-repository finalization."); }
  }

  private async revalidateCheckpoint(scope: Scope, manifest: SingleRepositoryManifest, intent: SingleRepositoryFinalizationIntent): Promise<void> {
    const checkpoint = await this.dependencies.ledger.read(scope.deliveryId), expectedManifest = singleRepositoryManifestContents(manifest), expectedIntent = singleRepositoryFinalizationIntentContents(intent);
    if (checkpoint.manifestBytes !== expectedManifest || (checkpoint.intentBytes !== expectedIntent && !(checkpoint.intentBytes === undefined && manifest.phase === "awaiting-human-merge"))) throw new SingleRepositoryError("checkpoint-conflict", "Durable single-repository manifest or intent changed before mutation.");
    this.requireIntent(scope, manifest, intent);
  }

  private async revalidateProvider(scope: Scope, manifest: SingleRepositoryManifest, intent: SingleRepositoryFinalizationIntent, provider: SingleRepositoryProviderSession, requireClosedIssue: boolean): Promise<void> {
    const pull = await provider.observeExistingPullRequest({ deliveryId: scope.deliveryId, resumeNumber: manifest.pullRequest.number }); this.requireMergedPull(pull, manifest.pullRequest, intent);
    if (intent.trackedIssue) { const current = await provider.observeTrackedIssue(scope.deliveryId); this.requireIssue(current, intent.trackedIssue); if (requireClosedIssue && current!.state !== "closed") throw new SingleRepositoryError("provider-mismatch", "Owned tracked issue is not durably closed after delivery deletion."); }
  }
  private cleanupStarted(journal: PromotionJournal, intent: SingleRepositoryFinalizationIntent): boolean { return this.hasRecoveryStep(journal); }
  private hasRecoveryStep(journal: PromotionJournal): boolean { return journal.entries.some((entry) => entry.step === "single-repository-workspace-cleanup-started" || entry.step === "single-repository-workspace-cleanup-completed" || entry.step === "single-repository-branch-delete-started" || entry.step === "single-repository-branch-deleted" || entry.step === "final-receipt-recorded"); }
  private hasExact(journal: PromotionJournal, step: PromotionJournalStep, key: string, sha: string): boolean { return exactJournal(journal, step, key, sha); }
  private async journalBare(deliveryId: string, step: PromotionJournalStep, key: string, sha: string): Promise<void> { const current = await this.dependencies.journal.read(deliveryId); if (exactJournal(current.journal, step, key, sha)) return; await this.dependencies.journal.append(current, { step, idempotencyKey: key, observedSha: sha, completedAt: this.now() }); if (!exactJournal((await this.dependencies.journal.read(deliveryId)).journal, step, key, sha)) throw new SingleRepositoryError("checkpoint-conflict", "Exact immutable recovery checkpoint was not durably recorded."); }
  private async resumePostCleanup(deliveryId: string, manifest: SingleRepositoryManifest, intent: SingleRepositoryFinalizationIntent): Promise<SingleRepositoryStatus> {
    // Past cleanup-started, the worktree may no longer exist.  More
    // importantly, the durable prefix has crossed the point at which live
    // certification authority could grant a different operation.  Resume from
    // immutable intent/journal only, with the narrow leased recovery session.
    this.requireImmutableBinding(manifest, intent, intent.actorLogin, manifest.repository, deliveryId);
    const originalManifestBytes = singleRepositoryManifestContents(manifest), originalIntentBytes = singleRepositoryFinalizationIntentContents(intent), entry = await this.dependencies.ledger.read(deliveryId);
    if (entry.manifestBytes !== originalManifestBytes || entry.intentBytes !== originalIntentBytes) throw new SingleRepositoryError("checkpoint-conflict", "Recovery checkpoint changed before mutable recovery work.");
    let journal = (await this.dependencies.journal.read(deliveryId)).journal;
    if (!this.hasExact(journal, "single-repository-branch-delete-started", `single-branch-delete-started:${intent.finalHeadSha}`, intent.finalHeadSha)) await this.journalBare(deliveryId, "single-repository-branch-delete-started", `single-branch-delete-started:${intent.finalHeadSha}`, intent.finalHeadSha);
    journal = (await this.dependencies.journal.read(deliveryId)).journal;
    // The just-appended tuple is not authority until the complete recovery
    // prefix is reread and validated.  Do this before opening even the narrow
    // recovery capability, which can observe/delete the remote branch.
    this.requireRecoveryJournal(journal, intent);
    const git = await this.dependencies.git.openRecovery({ repositoryPath: this.dependencies.repositoryPath, actorLogin: intent.actorLogin, repository: manifest.repository, deliveryBranch: manifest.branch, expectedMergeSha: intent.mergeCommitSha, expectedFinalHeadSha: intent.finalHeadSha });
    try {
      const alreadyDeleted = this.hasExact(journal, "single-repository-branch-deleted", `single-branch:${intent.finalHeadSha}`, intent.finalHeadSha), branch = await git.observeDeliveryBranchSha(manifest.branch);
      if (alreadyDeleted && branch !== undefined) throw new SingleRepositoryError("unsafe-recovery", "Deleted delivery branch was recreated.");
      if (!alreadyDeleted) { if (branch !== undefined && branch !== intent.finalHeadSha) throw new SingleRepositoryError("unsafe-recovery", "Remote delivery branch changed before narrow recovery deletion."); if (branch !== undefined) await git.deleteDeliveryBranch(manifest.branch, intent.finalHeadSha); await this.journalBare(deliveryId, "single-repository-branch-deleted", `single-branch:${intent.finalHeadSha}`, intent.finalHeadSha); }
      // A lost/corrupted journal response cannot be repaired by manufacturing
      // later proofs.  Validate the prefix again before the receipt CAS.
      this.requireRecoveryJournal((await this.dependencies.journal.read(deliveryId)).journal, intent);
      let checkpoint = await this.dependencies.ledger.read(deliveryId), complete = freeze({ ...manifest, phase: "complete" as const });
      if (checkpoint.manifestBytes !== originalManifestBytes || checkpoint.intentBytes !== originalIntentBytes) throw new SingleRepositoryError("checkpoint-conflict", "Recovery checkpoint changed before receipt advancement.");
      if (checkpoint.manifest!.phase !== "complete") { await this.dependencies.ledger.writeManifest(checkpoint, complete); checkpoint = await this.dependencies.ledger.read(intent.deliveryId); }
      const receipt = checkpoint.receipt ?? freeze({ schemaVersion: 1 as const, deliveryId, manifestDigest: intent.manifestDigest, finalHeadSha: intent.finalHeadSha, mainSha: intent.mainSha, mergeCommitSha: intent.mergeCommitSha, reviewedTag: intent.reviewedTag, pullRequestState: "merged" as const, trackedIssueState: intent.trackedIssue ? "closed" as const : "not-owned" as const, deliveryBranchDeleted: true as const, completedAt: this.now() });
      await this.dependencies.ledger.writeReceipt(checkpoint, receipt); await this.journalBare(deliveryId, "final-receipt-recorded", `single-final-receipt:${intent.manifestDigest}`, intent.mainSha); const seal = await this.dependencies.finalSeal.seal(deliveryId, intent.finalHeadSha, await this.dependencies.finalSeal.durableRecordPaths(deliveryId)); await git.publishLedger(seal);
      const completed = await this.dependencies.ledger.read(deliveryId), finalJournal = (await this.dependencies.journal.read(deliveryId)).journal;
      if (completed.manifestBytes !== singleRepositoryManifestContents(complete) || completed.intentBytes !== originalIntentBytes || completed.receiptBytes !== singleRepositoryFinalizationReceiptContents(receipt)) throw new SingleRepositoryError("checkpoint-conflict", "Final immutable checkpoint changed during recovery.");
      return this.inspectImmutablePostCleanup(manifest, intent, completed, finalJournal, seal);
    } finally { await git.release(); }
  }
  private requireImmutableBinding(manifest: SingleRepositoryManifest, intent: SingleRepositoryFinalizationIntent, actorLogin: string, repository: SingleRepositoryManifest["repository"], requestedDeliveryId?: string): void {
    const last = manifest.certifications.at(-1)!;
    const issueMatches = !manifest.trackedIssue && !intent.trackedIssue || !!manifest.trackedIssue && !!intent.trackedIssue && manifest.trackedIssue.id === intent.trackedIssue.id && manifest.trackedIssue.number === intent.trackedIssue.number && manifest.trackedIssue.url === intent.trackedIssue.url && manifest.trackedIssue.deliveryMarker === intent.trackedIssue.deliveryMarker;
    if ((requestedDeliveryId !== undefined && (manifest.deliveryId !== requestedDeliveryId || intent.deliveryId !== requestedDeliveryId)) || manifest.deliveryId !== intent.deliveryId || manifest.actorLogin !== actorLogin || intent.actorLogin !== actorLogin || manifest.branch !== `shipyard/${manifest.deliveryId}` || manifest.repository.owner !== repository.owner || manifest.repository.name !== repository.name || manifest.repository.defaultBranch !== repository.defaultBranch || manifest.repository.remote.name !== repository.remote.name || manifest.repository.remote.url !== repository.remote.url || manifest.pullRequest.repository.owner !== repository.owner || manifest.pullRequest.repository.name !== repository.name || manifest.pullRequest.headRepository.owner !== repository.owner || manifest.pullRequest.headRepository.name !== repository.name || manifest.pullRequest.baseRepository.owner !== repository.owner || manifest.pullRequest.baseRepository.name !== repository.name || manifest.pullRequest.headRef !== manifest.branch || manifest.pullRequest.baseRef !== repository.defaultBranch || manifest.pullRequest.deliveryMarker !== stableShipyardMarker(manifest.deliveryId) || manifest.pullRequest.dossierDigest !== last.dossierDigest || !issueMatches || manifest.pullRequest.state !== "merged" || manifest.pullRequest.mergeCommitSha !== intent.mergeCommitSha || manifest.pullRequest.headSha !== intent.finalHeadSha || last.headSha !== intent.finalHeadSha || last.headTreeSha !== intent.finalHeadTreeSha) throw new SingleRepositoryError("checkpoint-conflict", "Immutable finalization manifest and intent do not bind the exact actor, repository, PR, merge, and certified head.");
  }
  private async inspectImmutablePostCleanup(manifest: SingleRepositoryManifest, intent: SingleRepositoryFinalizationIntent, checkpoint: Awaited<ReturnType<SingleRepositoryLedger["read"]>>, journal: PromotionJournal, seal: string): Promise<SingleRepositoryStatus> {
    this.requireRecoveryJournal(journal, intent); this.requireFinalReceipt(checkpoint.receipt!, intent);
    const proofs: readonly [PromotionJournalStep, string, string][] = [["single-repository-branch-deleted", `single-branch:${intent.finalHeadSha}`, intent.finalHeadSha], ["final-receipt-recorded", `single-final-receipt:${intent.manifestDigest}`, intent.mainSha]];
    if (!proofs.every(([step, key, sha]) => exactJournal(journal, step, key, sha))) throw new SingleRepositoryError("checkpoint-conflict", "Exact finalization recovery proof is missing.");
    const verified = await this.dependencies.finalSeal.verifyExistingSeal(intent.deliveryId, intent.finalHeadSha); if (!verified || verified !== seal) return this.blockedStatus(manifest)("finalization-incomplete", "The exact final seal could not be verified.", "Resume finalization to repair the final seal safely.");
    const observed = await this.dependencies.git.observeFinalizationStatus({ repositoryPath: this.dependencies.repositoryPath, actorLogin: intent.actorLogin, repository: manifest.repository, deliveryBranch: manifest.branch, mergeCommitSha: intent.mergeCommitSha });
    if (observed.deliveryBranchSha !== undefined) throw new SingleRepositoryError("unsafe-recovery", "Deleted delivery branch was recreated.");
    if (observed.ledgerSha !== seal || !observed.mergeReachableFromMain) return this.blockedStatus(manifest)("finalization-incomplete", "The exact seal is unpublished or the pinned merge is not reachable from current main.", "Resume finalization to verify publication and merge reachability.");
    return freeze({ phase: "complete", deliveryId: intent.deliveryId, headSha: intent.finalHeadSha, pullRequest: { number: manifest.pullRequest.number, url: manifest.pullRequest.url, state: "merged", draft: manifest.pullRequest.draft }, sealSha: seal, blockers: Object.freeze([]), nextSafeAction: "Retain the reviewed tag and sealed ledger." });
  }
  private requireRecoveryJournal(journal: PromotionJournal, intent: SingleRepositoryFinalizationIntent): void {
    const proofs: readonly [PromotionJournalStep, string, string][] = [["single-repository-workspace-cleanup-started", `single-workspace-cleanup-started:${intent.finalHeadSha}`, intent.finalHeadSha], ["single-repository-workspace-cleanup-completed", `single-workspace-cleanup:${intent.finalHeadSha}`, intent.finalHeadSha], ["single-repository-branch-delete-started", `single-branch-delete-started:${intent.finalHeadSha}`, intent.finalHeadSha], ["single-repository-branch-deleted", `single-branch:${intent.finalHeadSha}`, intent.finalHeadSha], ["final-receipt-recorded", `single-final-receipt:${intent.manifestDigest}`, intent.mainSha]];
    for (const [step, key, sha] of proofs) {
      const entries = journal.entries.filter((entry) => entry.step === step);
      if (entries.length !== 0 && !exactJournal(journal, step, key, sha)) throw new SingleRepositoryError("checkpoint-conflict", "A one-shot finalization recovery checkpoint conflicts with its immutable tuple.");
    }
    const first = journal.entries.findIndex((entry) => proofs.some(([step]) => entry.step === step));
    if (first < 0) return;
    const suffix = journal.entries.slice(first);
    if (suffix.length > proofs.length) throw new SingleRepositoryError("checkpoint-conflict", "Finalization recovery checkpoint journal has an unrelated trailing entry.");
    for (let index = 0; index < suffix.length; index++) {
      const entry = suffix[index]!, [step, key, sha] = proofs[index]!;
      if (entry.step !== step || entry.idempotencyKey !== key || entry.observedSha !== sha || (index > 0 && entry.sequence !== suffix[index - 1]!.sequence + 1)) throw new SingleRepositoryError("checkpoint-conflict", "Finalization recovery checkpoint journal is not an exact consecutive proof prefix.");
    }
  }
  private blockedStatus(manifest: SingleRepositoryManifest): (code: string, message: string, action: string) => SingleRepositoryStatus {
    const last = manifest.certifications.at(-1)!;
    return (code, message, nextSafeAction) => freeze({ phase: manifest.phase === "complete" ? "finalizing" : manifest.phase, deliveryId: manifest.deliveryId, headSha: last.headSha, pullRequest: { number: manifest.pullRequest.number, url: manifest.pullRequest.url, state: manifest.pullRequest.state, draft: manifest.pullRequest.draft }, blockers: Object.freeze([{ code, message }]), nextSafeAction });
  }
  private requireIntent(scope: Scope, manifest: SingleRepositoryManifest, intent: SingleRepositoryFinalizationIntent): void { const last = manifest.certifications.at(-1)!, awaiting: SingleRepositoryManifest = { ...manifest, pullRequest: { ...manifest.pullRequest, state: "open", mergeCommitSha: undefined }, phase: "awaiting-human-merge" }; if (manifest.phase !== "awaiting-human-merge") this.requireImmutableBinding(manifest, intent, scope.authority.actorLogin, scope.authority.topology.repository); if (intent.deliveryId !== scope.deliveryId || intent.actorLogin !== scope.authority.actorLogin || intent.finalHeadSha !== last.headSha || intent.finalHeadTreeSha !== last.headTreeSha || intent.manifestDigest !== singleRepositoryManifestDigest(awaiting)) throw new SingleRepositoryError("checkpoint-conflict", "Immutable finalization intent no longer matches certification authority."); }
  private requireFinalReceipt(receipt: SingleRepositoryFinalizationReceipt, intent: SingleRepositoryFinalizationIntent): void { if (receipt.deliveryId !== intent.deliveryId || receipt.manifestDigest !== intent.manifestDigest || receipt.finalHeadSha !== intent.finalHeadSha || receipt.mainSha !== intent.mainSha || receipt.mergeCommitSha !== intent.mergeCommitSha || receipt.reviewedTag !== intent.reviewedTag || receipt.pullRequestState !== "merged" || receipt.deliveryBranchDeleted !== true || receipt.trackedIssueState !== (intent.trackedIssue ? "closed" : "not-owned")) throw new SingleRepositoryError("checkpoint-conflict", "Finalization receipt does not match immutable intent."); }
  private requireMergedPull(pull: SingleRepositoryPullRequest, expected: SingleRepositoryPullRequest, intent: Pick<SingleRepositoryFinalizationIntent, "finalHeadSha" | "mergeCommitSha">): void { if (pull.state !== "merged" || !pull.mergeCommitSha || pull.mergeCommitSha !== intent.mergeCommitSha || pull.headSha !== intent.finalHeadSha || pull.id !== expected.id || pull.number !== expected.number || pull.url !== expected.url || pull.deliveryMarker !== expected.deliveryMarker || pull.headRef !== expected.headRef || pull.baseRef !== expected.baseRef || pull.baseSha !== expected.baseSha || pull.dossierDigest !== expected.dossierDigest || pull.repository.owner !== expected.repository.owner || pull.repository.name !== expected.repository.name || pull.headRepository.owner !== expected.headRepository.owner || pull.headRepository.name !== expected.headRepository.name || pull.baseRepository.owner !== expected.baseRepository.owner || pull.baseRepository.name !== expected.baseRepository.name || pull.isCrossRepository !== false) throw new SingleRepositoryError("human-merge-required", "Expected same-repository pull request merge identity, head, base, dossier, or topology is not verified."); }
  private requireReceipt(scope: Scope, certification: SingleRepositoryCertification, receipt: TrustedAcceptanceReceipt): void { if (!receipt.decision.promotionEligible || receipt.deliveryId !== scope.deliveryId || receipt.actorLogin !== scope.authority.actorLogin || !sameEvidence(certification.evidence, receipt)) throw new SingleRepositoryError("evidence-stale", "Final exact-SHA acceptance/review receipt is stale."); }
  private requireIssue(current: SingleRepositoryTrackedIssue | undefined, expected: SingleRepositoryTrackedIssue): void { if (!current || current.id !== expected.id || current.number !== expected.number || current.url !== expected.url || current.deliveryMarker !== expected.deliveryMarker) throw new SingleRepositoryError("provider-mismatch", "Tracked issue identity changed before finalization mutation."); }
  private async journalFull(scope: Scope, manifest: SingleRepositoryManifest, intent: SingleRepositoryFinalizationIntent, provider: SingleRepositoryProviderSession, step: PromotionJournalStep, key: string, sha?: string, providerId?: string, git?: SingleRepositoryFinalizationGitSession): Promise<void> { const current = await this.dependencies.journal.read(scope.deliveryId); await this.revalidateFull(scope, manifest, intent, provider, git); await this.dependencies.journal.append(current, { step, idempotencyKey: key, ...(sha ? { observedSha: sha } : {}), ...(providerId ? { providerId } : {}), completedAt: this.now() }); if (!exactJournal((await this.dependencies.journal.read(scope.deliveryId)).journal, step, key, sha, providerId)) throw new SingleRepositoryError("checkpoint-conflict", "Exact finalization journal tuple was not durably recorded."); }
  private async journalReduced(scope: Scope, manifest: SingleRepositoryManifest, intent: SingleRepositoryFinalizationIntent, provider: SingleRepositoryProviderSession, requiredJournalSteps: readonly PromotionJournalStep[], step: PromotionJournalStep, key: string, sha?: string, providerId?: string, git?: SingleRepositoryFinalizationGitSession): Promise<void> { const current = await this.dependencies.journal.read(scope.deliveryId); await this.revalidateReduced(scope, manifest, intent, provider, requiredJournalSteps, git); await this.dependencies.journal.append(current, { step, idempotencyKey: key, ...(sha ? { observedSha: sha } : {}), ...(providerId ? { providerId } : {}), completedAt: this.now() }); if (!exactJournal((await this.dependencies.journal.read(scope.deliveryId)).journal, step, key, sha, providerId)) throw new SingleRepositoryError("checkpoint-conflict", "Exact finalization journal tuple was not durably recorded."); }
  private now(): string { const value = (this.dependencies.now ?? (() => new Date()))(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new SingleRepositoryError("invalid-state", "Trusted finalization clock is unavailable."); return value.toISOString(); }
}

type Scope = Readonly<{ deliveryId: string; authority: BoundProfileAuthority & { topology: Extract<BoundProfileAuthority["topology"], { kind: "single-repository" }> }; profile: Awaited<ReturnType<ProfileReader["read"]>>; worktreePath?: string; workspace?: SingleRepositoryManifest["workspace"] }>;
function sameEvidence(pin: PromotionEvidencePin, receipt: TrustedAcceptanceReceipt): boolean { return pin.productSha === receipt.productSha && pin.manifestDigest === receipt.manifestDigest && pin.acceptanceDigest === receipt.acceptanceDigest && pin.reviewId === receipt.reviewId && pin.reviewRequestDigest === receipt.reviewRequestDigest && pin.reviewResultDigest === receipt.reviewResultDigest && pin.reviewedLedgerSha === receipt.reviewedLedgerSha && pin.reviewerBundleDigest === receipt.reviewerBundleDigest; }
function sameWorkspace(left: SingleRepositoryManifest["workspace"], right: SingleRepositoryManifest["workspace"]): boolean { return left.creationToken === right.creationToken && left.commonDirectory === right.commonDirectory && left.worktreePath === right.worktreePath; }
const exactJournal = exactSingleRepositoryOneShotJournalTuple;
export { exactSingleRepositoryOneShotJournalTuple as exactSingleRepositoryJournalTuple } from "./ledger.js";
function selection(value: unknown): string { if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid(); const keys = Reflect.ownKeys(value); if (keys.length !== 1 || keys[0] !== "deliveryId") throw invalid(); const descriptor = Object.getOwnPropertyDescriptor(value, "deliveryId"); if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") throw invalid(); const id = descriptor.value; if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) || id.includes("..")) throw invalid(); return id; }
function construction(value: unknown): TrustedSingleRepositoryFinalizationDependencies { const keys = ["repositoryPath", "authority", "profiles", "deliveries", "evidence", "product", "git", "provider", "ledger", "journal", "finalSeal", "cleanup", "mergePolicy", "locks", "lockPath", "now"], optional = ["now"]; if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid(); const out: Record<string, unknown> = {}; for (const key of Reflect.ownKeys(value)) { if (typeof key !== "string" || !keys.includes(key)) throw invalid(); const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !("value" in descriptor)) throw invalid(); out[key] = descriptor.value; } if (keys.some((key) => !optional.includes(key) && !(key in out)) || typeof out.repositoryPath !== "string" || !out.repositoryPath.trim()) throw invalid(); return out as TrustedSingleRepositoryFinalizationDependencies; }
function invalid(): SingleRepositoryError { return new SingleRepositoryError("invalid-state", "Single-repository finalization accepts only one stable delivery ID and fixed trusted dependencies."); }
function exactRepositoryUrl(repository: { owner: string; name: string; remote: { url: string } }): boolean { return repository.remote.url === `https://github.com/${repository.owner}/${repository.name}` || repository.remote.url === `https://github.com/${repository.owner}/${repository.name}.git`; }
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) freeze(child); Object.freeze(value); } return value; }
