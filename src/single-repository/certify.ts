import type { TrustedAcceptanceGate, TrustedAcceptanceReceipt } from "../acceptance/gate.js";
import type { DeliveryResolver } from "../delivery/resolver.js";
import type { MutationLockService } from "../locking/mutation-lock.js";
import type { BoundProfileAuthority, BoundProfileAuthorityResolver } from "../profile/bound-authority.js";
import { profileFingerprint } from "../profile/fingerprint.js";
import { requireProfileAuthorization, sameTopology, type ProfileReader } from "../profile/policy.js";
import { PromotionLedger } from "../promotion/manifest.js";
import { evidencePin, type PromotionEvidencePin, type PromotionJournalStep } from "../promotion/types.js";
import { dossierDigest, singleRepositoryDossier } from "./dossier.js";
import { SingleRepositoryError } from "./errors.js";
import { exactSingleRepositoryJournalTuple, SingleRepositoryLedger } from "./ledger.js";
import { singleRepositoryPolicyDigest } from "./policy.js";
import type { SingleRepositoryProviderAuthority, SingleRepositoryProviderSession } from "./provider.js";
import type { SingleRepositoryCertification, SingleRepositoryManifest, SingleRepositoryProductAuthority, SingleRepositoryProductObservation, SingleRepositoryPullRequest, SingleRepositoryStatus, SingleRepositoryTrackedIssue } from "./types.js";

export type TrustedSingleRepositoryCertificationDependencies = Readonly<{
  repositoryPath: string;
  authority: BoundProfileAuthorityResolver;
  profiles: ProfileReader;
  deliveries: Pick<DeliveryResolver, "resolve">;
  evidence: TrustedAcceptanceGate;
  product: SingleRepositoryProductAuthority;
  provider: SingleRepositoryProviderAuthority;
  ledger: SingleRepositoryLedger;
  journal: PromotionLedger;
  locks: MutationLockService;
  lockPath(commonDirectory: string): string;
  now?: () => Date;
}>;

export interface TrustedSingleRepositoryCertificationOperation {
  certifyExistingPr(input: Readonly<{ deliveryId: string }>): Promise<SingleRepositoryStatus>;
}

export function createTrustedSingleRepositoryCertificationOperation(raw: TrustedSingleRepositoryCertificationDependencies): TrustedSingleRepositoryCertificationOperation {
  const dependencies = construction(raw), service = new SingleRepositoryCertificationService(dependencies);
  return Object.freeze({ certifyExistingPr: (input: Readonly<{ deliveryId: string }>) => service.run(input) });
}

class SingleRepositoryCertificationService {
  constructor(private readonly dependencies: TrustedSingleRepositoryCertificationDependencies) {}

  async run(input: Readonly<{ deliveryId: string }>): Promise<SingleRepositoryStatus> {
    const deliveryId = selection(input), pre = await this.dependencies.authority.resolve(this.dependencies.repositoryPath, "promote"), lock = await this.dependencies.locks.acquire(this.dependencies.lockPath(pre.commonDirectory), pre.commonDirectory, "single-repository-certify");
    try {
      const scope = await this.scope(deliveryId, pre), receipt = await this.receipt(scope), checkpoint = await this.dependencies.ledger.read(deliveryId), existing = checkpoint.manifest;
      if (existing && (existing.phase === "finalizing" || existing.phase === "complete")) throw new SingleRepositoryError("invalid-state", "A finalizing or complete single-repository delivery cannot be recertified.");
      const provider = await this.dependencies.provider.open({ actorLogin: scope.authority.actorLogin, repository: scope.authority.topology.repository }), pull = await provider.observeExistingPullRequest({ deliveryId, ...(existing ? { resumeNumber: existing.pullRequest.number } : {}) });
      this.requirePull(scope, pull, receipt.productSha);
      // The provider's canonical base is an immutable input to the local exact delta.
      const product = await this.dependencies.product.observe({ repositoryPath: scope.worktreePath, branch: scope.branch, expectedHeadSha: receipt.productSha, expectedBaseSha: pull.baseSha }), policyDigest = singleRepositoryPolicyDigest(scope.profile, product);
      const trackedIssue = existing?.trackedIssue ?? await provider.observeTrackedIssue(deliveryId);
      if (existing?.trackedIssue) this.requireIssue(await provider.observeTrackedIssue(deliveryId), existing.trackedIssue);
      let manifest: SingleRepositoryManifest, certification: SingleRepositoryCertification;
      const last = existing?.certifications.at(-1);
      if (last?.headSha === receipt.productSha && sameEvidence(last.evidence, receipt)) {
        this.requireExisting(scope, existing!, last, receipt, product, policyDigest, pull);
        manifest = existing!; certification = last;
      } else {
        if (existing && !samePullIdentity(existing.pullRequest, pull)) throw new SingleRepositoryError("provider-mismatch", "The existing pull request was replaced while awaiting renewed certification.");
        const revision = (last?.revision ?? 0) + 1, provisional: SingleRepositoryCertification = freeze({ revision, headSha: receipt.productSha, headTreeSha: product.headTreeSha, baseSha: pull.baseSha, policyDigest, dossierDigest: "0".repeat(64), evidence: evidencePin(receipt), certifiedAt: this.now() }), certifications = Object.freeze([...(existing?.certifications ?? []), provisional]), desiredDossier = singleRepositoryDossier(deliveryId, certifications);
        certification = freeze({ ...provisional, dossierDigest: dossierDigest(desiredDossier) });
        manifest = freeze({ schemaVersion: 1 as const, topology: "single-repository" as const, deliveryId, actorLogin: scope.authority.actorLogin, repository: scope.authority.topology.repository, branch: scope.branch, workspace: scope.workspace, pullRequest: pull, ...(trackedIssue ? { trackedIssue } : {}), certifications: Object.freeze([...(existing?.certifications ?? []), certification]), phase: "certifying" as const });
        await this.requireJournalVacantOrExact(deliveryId, "single-repository-dossier-updated", `single-dossier:${certification.dossierDigest}`, pull.headSha, pull.id);
        await this.requireJournalVacantOrExact(deliveryId, "single-repository-pr-certified", `single-certified:${certification.headSha}:${certification.dossierDigest}`, certification.headSha, pull.id);
        await this.revalidate(scope, receipt, certification, manifest, provider);
        await this.dependencies.ledger.writeManifest(checkpoint, manifest);
      }
      return await this.ensureCertified(scope, receipt, certification, manifest, provider);
    } finally { await lock.release(); }
  }

  private async ensureCertified(scope: Scope, receipt: TrustedAcceptanceReceipt, certification: SingleRepositoryCertification, manifest: SingleRepositoryManifest, provider: SingleRepositoryProviderSession): Promise<SingleRepositoryStatus> {
    const dossier = singleRepositoryDossier(scope.deliveryId, manifest.certifications); if (dossierDigest(dossier) !== certification.dossierDigest) throw new SingleRepositoryError("checkpoint-conflict", "Checkpointed dossier digest no longer matches the canonical certification dossier.");
    let current = await this.revalidate(scope, receipt, certification, manifest, provider);
    await this.requireJournalVacantOrExact(scope.deliveryId, "single-repository-dossier-updated", `single-dossier:${certification.dossierDigest}`, current.headSha, current.id);
    current = await provider.updateReviewDossier({ expected: current, dossier });
    await this.revalidate(scope, receipt, certification, manifest, provider);
    await this.journal(scope, receipt, certification, manifest, provider, "single-repository-dossier-updated", `single-dossier:${certification.dossierDigest}`, current.headSha, current.id);
    current = await this.revalidate(scope, receipt, certification, manifest, provider);
    await this.requireJournalVacantOrExact(scope.deliveryId, "single-repository-pr-certified", `single-certified:${certification.headSha}:${certification.dossierDigest}`, certification.headSha, current.id);
    current = await provider.markReady({ expected: current, dossierDigest: certification.dossierDigest });
    await this.revalidate(scope, receipt, certification, manifest, provider);
    await this.journal(scope, receipt, certification, manifest, provider, "single-repository-pr-certified", `single-certified:${certification.headSha}:${certification.dossierDigest}`, certification.headSha, current.id);
    if (current.state !== "open" || current.draft || current.dossierDigest !== certification.dossierDigest) throw new SingleRepositoryError("unsafe-recovery", "Existing pull request certification was not confirmed exactly.");
    const durable: SingleRepositoryManifest = freeze({ ...manifest, pullRequest: current, phase: "awaiting-human-merge" as const }), latest = await this.dependencies.ledger.read(scope.deliveryId);
    await this.revalidate(scope, receipt, certification, manifest, provider);
    await this.dependencies.ledger.writeManifest(latest, durable);
    return status(durable);
  }

  private async revalidate(scope: Scope, expectedReceipt: TrustedAcceptanceReceipt, certification: SingleRepositoryCertification, manifest: SingleRepositoryManifest, provider: SingleRepositoryProviderSession): Promise<SingleRepositoryPullRequest> {
    const fresh = await this.scope(scope.deliveryId, scope.authority), receipt = await this.receipt(fresh); if (!sameWorkspace(manifest.workspace, fresh.workspace)) throw new SingleRepositoryError("checkpoint-conflict", "Delivery workspace instance changed before certification mutation."); if (!sameReceipt(expectedReceipt, receipt) || !sameEvidence(certification.evidence, receipt)) throw new SingleRepositoryError("evidence-stale", "Exact-SHA acceptance/review authority changed before certification mutation.");
    const product = await this.dependencies.product.observe({ repositoryPath: fresh.worktreePath, branch: fresh.branch, expectedHeadSha: certification.headSha, expectedBaseSha: certification.baseSha }), policy = singleRepositoryPolicyDigest(fresh.profile, product);
    if (product.baseSha !== certification.baseSha || product.headTreeSha !== certification.headTreeSha || policy !== certification.policyDigest) throw new SingleRepositoryError("path-policy", "Exact PR-head tree or path policy changed before certification mutation.");
    const pull = await provider.observeExistingPullRequest({ deliveryId: scope.deliveryId, resumeNumber: manifest.pullRequest.number }); this.requirePull(fresh, pull, certification.headSha);
    if (!samePullIdentity(manifest.pullRequest, pull) || pull.baseSha !== certification.baseSha) throw new SingleRepositoryError("provider-mismatch", "Existing pull request identity or base changed before certification mutation.");
    // Keep the authority check as the final operation before a caller can mutate durable state.
    await this.scope(scope.deliveryId, scope.authority);
    return pull;
  }

  private async scope(deliveryId: string, expected: BoundProfileAuthority): Promise<Scope> {
    const resolved = await this.dependencies.deliveries.resolve({ repositoryPath: this.dependencies.repositoryPath, deliveryId }), authority = await this.dependencies.authority.resolve(resolved.workspace.worktreePath, "promote"), profile = await this.dependencies.profiles.read(authority.profileName);
    if (authority.topology.kind !== "single-repository" || authority.commonDirectory !== expected.commonDirectory || resolved.binding.commonDirectory !== authority.commonDirectory || resolved.binding.profileFingerprint !== authority.profileFingerprint || !sameTopology(resolved.binding.topology, authority.topology) || profile.name !== authority.profileName || profile.actor.login !== authority.actorLogin || profileFingerprint(profile) !== authority.profileFingerprint || !sameTopology(profile.topology, authority.topology) || resolved.workspace.branch !== `shipyard/${deliveryId}`) throw new SingleRepositoryError("authority-changed", "Binding, delivery, profile, actor, or single-repository topology changed.");
    try { requireProfileAuthorization(profile, "promote"); } catch { throw new SingleRepositoryError("authority-changed", "Profile no longer authorizes single-repository certification."); }
    if (!exactRepositoryUrl(authority.topology.repository)) throw new SingleRepositoryError("authority-changed", "Single-repository Git remote no longer matches the bound GitHub repository.");
    return freeze({ deliveryId, worktreePath: resolved.workspace.worktreePath, branch: resolved.workspace.branch, workspace: freeze({ creationToken: resolved.workspace.creationToken, commonDirectory: resolved.workspace.commonDirectory, worktreePath: resolved.workspace.worktreePath }), authority: authority as Scope["authority"], profile });
  }

  private async receipt(scope: Scope): Promise<TrustedAcceptanceReceipt> { const receipt = await this.dependencies.evidence.evaluateReceipt(); if (!receipt.decision.promotionEligible || receipt.deliveryId !== scope.deliveryId || receipt.actorLogin !== scope.authority.actorLogin) throw new SingleRepositoryError("evidence-stale", "Complete current exact-SHA acceptance and independent review are required."); return receipt; }
  private requirePull(scope: Scope, pull: SingleRepositoryPullRequest, headSha: string): void { const repository = scope.authority.topology.repository; if (pull.state !== "open" || pull.mergeCommitSha || pull.repository.owner !== repository.owner || pull.repository.name !== repository.name || pull.headRepository.owner !== repository.owner || pull.headRepository.name !== repository.name || pull.baseRepository.owner !== repository.owner || pull.baseRepository.name !== repository.name || pull.isCrossRepository !== false || pull.headRef !== scope.branch || pull.baseRef !== repository.defaultBranch || pull.headSha !== headSha) throw new SingleRepositoryError("provider-mismatch", "The one existing pull request is closed, merged, forked, retargeted, or at the wrong exact head."); }
  private requireExisting(scope: Scope, manifest: SingleRepositoryManifest, last: SingleRepositoryCertification, receipt: TrustedAcceptanceReceipt, product: SingleRepositoryProductObservation, policy: string, pull: SingleRepositoryPullRequest): void { if (manifest.actorLogin !== scope.authority.actorLogin || !sameTopology({ kind: "single-repository", repository: manifest.repository }, scope.authority.topology) || manifest.branch !== scope.branch || !sameWorkspace(manifest.workspace, scope.workspace) || !samePullIdentity(manifest.pullRequest, pull) || pull.baseSha !== last.baseSha || product.headTreeSha !== last.headTreeSha || policy !== last.policyDigest || !sameEvidence(last.evidence, receipt)) throw new SingleRepositoryError("checkpoint-conflict", "Existing exact-head certification no longer matches current authority."); }
  private requireIssue(current: SingleRepositoryTrackedIssue | undefined, expected: SingleRepositoryTrackedIssue): void { if (!current || !sameIssue(current, expected)) throw new SingleRepositoryError("provider-mismatch", "Checkpointed tracked issue is missing or replaced."); }
  /** A journal append is durable mutation too: reread first, then run the full
   * certification freshness proof (including product and canonical PR) before it. */
  private async journal(scope: Scope, receipt: TrustedAcceptanceReceipt, certification: SingleRepositoryCertification, manifest: SingleRepositoryManifest, provider: SingleRepositoryProviderSession, step: PromotionJournalStep, key: string, sha?: string, providerId?: string): Promise<void> { const current = await this.dependencies.journal.read(scope.deliveryId); await this.revalidate(scope, receipt, certification, manifest, provider); await this.dependencies.journal.append(current, { step, idempotencyKey: key, ...(sha ? { observedSha: sha } : {}), ...(providerId ? { providerId } : {}), completedAt: this.now() }); if (!exactSingleRepositoryJournalTuple((await this.dependencies.journal.read(scope.deliveryId)).journal, step, key, sha, providerId)) throw new SingleRepositoryError("checkpoint-conflict", "Exact certification journal tuple was not durably recorded."); }
  private async requireJournalVacantOrExact(deliveryId: string, step: PromotionJournalStep, key: string, sha?: string, providerId?: string): Promise<void> { const journal = (await this.dependencies.journal.read(deliveryId)).journal, entries = journal.entries.filter((entry) => entry.idempotencyKey === key); if (entries.length === 0 || exactSingleRepositoryJournalTuple(journal, step, key, sha, providerId)) return; throw new SingleRepositoryError("checkpoint-conflict", "Certification journal key is duplicated or conflicts with the exact durable proof."); }
  private now(): string { const value = (this.dependencies.now ?? (() => new Date()))(); if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new SingleRepositoryError("invalid-state", "Trusted certification clock is unavailable."); return value.toISOString(); }
}

type Scope = Readonly<{ deliveryId: string; worktreePath: string; branch: string; workspace: SingleRepositoryManifest["workspace"]; authority: BoundProfileAuthority & { topology: Extract<BoundProfileAuthority["topology"], { kind: "single-repository" }> }; profile: Awaited<ReturnType<ProfileReader["read"]>> }>;
// ledgerSha is an inventory head and legitimately moves when this operation checkpoints.
// reviewedLedgerSha remains the immutable acceptance-review evidence pin.
function sameEvidence(pin: PromotionEvidencePin, receipt: TrustedAcceptanceReceipt): boolean { return pin.productSha === receipt.productSha && pin.manifestDigest === receipt.manifestDigest && pin.acceptanceDigest === receipt.acceptanceDigest && pin.reviewId === receipt.reviewId && pin.reviewRequestDigest === receipt.reviewRequestDigest && pin.reviewResultDigest === receipt.reviewResultDigest && pin.reviewedLedgerSha === receipt.reviewedLedgerSha && pin.reviewerBundleDigest === receipt.reviewerBundleDigest; }
function sameReceipt(left: TrustedAcceptanceReceipt, right: TrustedAcceptanceReceipt): boolean { return left.productSha === right.productSha && left.manifestDigest === right.manifestDigest && left.acceptanceDigest === right.acceptanceDigest && left.reviewId === right.reviewId && left.reviewRequestDigest === right.reviewRequestDigest && left.reviewResultDigest === right.reviewResultDigest && left.reviewedLedgerSha === right.reviewedLedgerSha && left.reviewerBundleDigest === right.reviewerBundleDigest; }
function samePullIdentity(left: SingleRepositoryPullRequest, right: SingleRepositoryPullRequest): boolean { return left.id === right.id && left.number === right.number && left.url === right.url && left.deliveryMarker === right.deliveryMarker && left.repository.owner === right.repository.owner && left.repository.name === right.repository.name && left.headRepository.owner === right.headRepository.owner && left.headRepository.name === right.headRepository.name && left.baseRepository.owner === right.baseRepository.owner && left.baseRepository.name === right.baseRepository.name && left.headRef === right.headRef && left.baseRef === right.baseRef && left.isCrossRepository === false && right.isCrossRepository === false; }
function sameIssue(left: SingleRepositoryTrackedIssue, right: SingleRepositoryTrackedIssue): boolean { return left.id === right.id && left.number === right.number && left.url === right.url && left.deliveryMarker === right.deliveryMarker; }
function sameWorkspace(left: SingleRepositoryManifest["workspace"], right: SingleRepositoryManifest["workspace"]): boolean { return left.creationToken === right.creationToken && left.commonDirectory === right.commonDirectory && left.worktreePath === right.worktreePath; }
function selection(value: unknown): string { if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalidSelection(); const keys = Reflect.ownKeys(value); if (keys.length !== 1 || keys[0] !== "deliveryId") throw invalidSelection(); const descriptor = Object.getOwnPropertyDescriptor(value, "deliveryId"); if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || typeof descriptor.value !== "string") throw invalidSelection(); const id = descriptor.value; if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id) || id.includes("..")) throw invalidSelection(); return id; }
function invalidSelection(): SingleRepositoryError { return new SingleRepositoryError("invalid-state", "Single-repository certification accepts only one stable delivery ID."); }
function exactRepositoryUrl(repository: { owner: string; name: string; remote: { url: string } }): boolean { return repository.remote.url === `https://github.com/${repository.owner}/${repository.name}` || repository.remote.url === `https://github.com/${repository.owner}/${repository.name}.git`; }
function construction(value: unknown): TrustedSingleRepositoryCertificationDependencies { const keys = ["repositoryPath", "authority", "profiles", "deliveries", "evidence", "product", "provider", "ledger", "journal", "locks", "lockPath", "now"], optional = ["now"]; if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalidSelection(); const out: Record<string, unknown> = {}; for (const key of Reflect.ownKeys(value)) { if (typeof key !== "string" || !keys.includes(key)) throw invalidSelection(); const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !("value" in descriptor)) throw invalidSelection(); out[key] = descriptor.value; } if (keys.some((key) => !optional.includes(key) && !(key in out)) || typeof out.repositoryPath !== "string" || !out.repositoryPath.trim()) throw invalidSelection(); return out as TrustedSingleRepositoryCertificationDependencies; }
function status(manifest: SingleRepositoryManifest): SingleRepositoryStatus { const last = manifest.certifications.at(-1)!; return freeze({ phase: manifest.phase, deliveryId: manifest.deliveryId, headSha: last.headSha, pullRequest: { number: manifest.pullRequest.number, url: manifest.pullRequest.url, state: manifest.pullRequest.state, draft: manifest.pullRequest.draft }, blockers: Object.freeze([]), nextSafeAction: "Wait for human/team merge, or renew acceptance and certify a changed exact PR head." }); }
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) freeze(child); Object.freeze(value); } return value; }
