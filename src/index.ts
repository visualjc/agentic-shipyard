export { CONTRACT_VERSION, DELIVERY_PHASES, OPERATIONS } from "./contracts/types.js";
export type { Binding, ContractVersion, DeliveryPhase, GitHubActor, GraphProfile, LifecycleState, Operation, PathOwner, PathPolicy, PathRule, Profile, RemoteExpectation, RepositoryRef, SingleRepositoryTopology, StagedPairTopology, Topology } from "./contracts/types.js";
export { ContractValidationError, validateBinding, validateLifecycleState, validateOperation, validatePathPolicy, validateProfile, validateRemoteExpectation } from "./contracts/validate.js";
export type { ContractErrorCode } from "./contracts/errors.js";
export { composeStatus, createStatusProjection } from "./status/projection.js";
export type { StatusBlocker, StatusContributor, StatusProjection, SyncFreshness } from "./status/projection.js";
export { graphStatusContributor } from "./graph/status.js";
export { createGitGraphSourceReader, graphFingerprint, snapshotGraphSource } from "./graph/fingerprint.js";
export { graphCacheIdentity, graphDecision, graphLockPath, evaluateGraphFreshness, evaluateGraphLock, validateGraphDescriptor } from "./graph/freshness.js";
export { graphPathContains, isGraphSha, validateGraphDecision, validateGraphDescriptor as validateGraphDescriptorValue, validateGraphLock, validateGraphRuntime, validateGraphSource } from "./graph/validation.js";
export { GraphLockService } from "./graph/lock.js";
export type { GraphLockStore } from "./graph/lock.js";
export { canonicalExecutable, commandFailure, GRAPH_COMMAND_MAX_BYTES, snapshotGraphCommandResult } from "./graph/command.js";
export type { GraphCommandResult } from "./graph/command.js";
export { GRAPH_FALLBACK_ACTION, GRAPH_FINGERPRINT_VERSION, GRAPH_STATES } from "./graph/types.js";
export type { GraphBaseline, GraphCacheLock, GraphDecision, GraphDescriptor, GraphResult, GraphRuntime, GraphSource, GraphState } from "./graph/types.js";
export type { GraphSourceReader } from "./graph/fingerprint.js";
export { GRAPHIFY_RECEIPT } from "./adapters/graphify.js";
export { CODEGRAPH_RECEIPT } from "./adapters/codegraph.js";
export { authorizeGitGraphBaseline, GraphSeedAuthorization } from "./graph/baseline.js";
export type { GitGraphBaselineRequest } from "./graph/baseline.js";
export { createGraphLaneService } from "./graph/service.js";
export type { GraphLaneController, GraphLaneStatusReader } from "./graph/service.js";

// Binding/core adapters are deliberately exported by interface, not by module internals.
export { nodeFilesystem } from "./adapters/filesystem.js";
export type { ExclusiveDirectoryResult, FilesystemAdapter } from "./adapters/filesystem.js";
export { nodeGit } from "./adapters/git.js";
export type { GitAdapter } from "./adapters/git.js";
export { nodeProcess } from "./adapters/process.js";
export type { ProcessAdapter } from "./adapters/process.js";
export { BindingError } from "./binding/errors.js";
export { BindingService, newBindingDocument, validateBindingDocument, validateBoundRepository, validateRemotes, validateTopology } from "./binding/service.js";
export { JsonBindingStore } from "./binding/store.js";
export type { BindingDocument, BindingStore, RepositoryBinding, RepositoryTopology } from "./binding/types.js";
export type { ProfileReader, TopologyRequest } from "./profile/policy.js";
export { requireMatchingTopology, requireProfileAuthorization, sameTopology } from "./profile/policy.js";
export { PROFILE_FINGERPRINT_ALGORITHM, profileFingerprint } from "./profile/fingerprint.js";
export { ActiveBoundProfileAuthorityResolver, boundProfileAuthority } from "./profile/bound-authority.js";
export type { BoundProfileAuthority, BoundProfileAuthorityResolver } from "./profile/bound-authority.js";
export { PathPolicyError, classifyPath, classifyPaths, classifyProfilePath } from "./policy/path-classifier.js";
export { MutationLockError, MutationLockService } from "./locking/mutation-lock.js";
export type { AcquiredMutationLock, MutationLockRecord } from "./locking/mutation-lock.js";

// Delivery/workspace and isolated-ledger interfaces.
export { DeliveryError } from "./delivery/errors.js";
export type { DeliveryFailureCode } from "./delivery/errors.js";
export { JsonDeliveryRegistry, canonicalAbsolutePath, canonicalWorkspaceBranch, newDeliveryRegistryDocument, stableDeliveryId, validateDeliveryRegistryDocument } from "./delivery/registry.js";
export { DeliveryResolver } from "./delivery/resolver.js";
export { deliveryStatusContributor } from "./delivery/status.js";
export type { DeliveryStatusPins } from "./delivery/status.js";
export type { DeliveryReadinessVerifier, DeliveryRegistry, DeliveryRegistryDocument, DeliveryResolutionRequest, DeliveryWorkspace, ResolvedDelivery } from "./delivery/types.js";
export { LedgerError } from "./ledger/errors.js";
export type { LedgerFailureCode } from "./ledger/errors.js";
export { applyLedgerTransaction, validLedgerPath } from "./ledger/transaction.js";
export { createFinalLedgerSeal, finalSealManifest, finalSealPath, sealDelivery, validateFinalLedgerSeal, verifyFinalLedgerSeal } from "./ledger/final-seal.js";
export type { CreateFinalLedgerSeal, FinalLedgerSeal, FinalLedgerSealManifestEntry, FinalLedgerSealObservation, SealDeliveryRequest } from "./ledger/final-seal.js";
export type { LedgerCommitChange, LedgerCommitInspection, LedgerInventory, LedgerInventoryEntry, LedgerInventoryReader, LedgerSnapshot, LedgerStore, LedgerTransaction, LedgerWrite } from "./ledger/types.js";
export { createGitLedgerStore, GitLedgerStore } from "./adapters/ledger-git.js";
export { WorkspaceError } from "./workspace/errors.js";
export type { WorkspaceFailureCode } from "./workspace/errors.js";
export { createNodeWorkspaceGit, WorkspaceService, nodeWorkspaceGit } from "./workspace/service.js";
export type { CreateOrResumeDelivery, InitialDeliveryLedgerRecord, WorkspaceGit, WorkspaceGitIdentity, WorktreeEnsureIntent } from "./workspace/service.js";
export type { WorkspaceProofKind, WorkspaceProofObservation, WorkspaceProofRecord } from "./workspace/proof.js";

// Role-limited, exact-SHA worker context.
export { ContextError } from "./context/errors.js";
export type { ContextFailureCode } from "./context/errors.js";
export { allowedRecordPaths, createEnvelope, validateContextEnvelope } from "./context/envelope.js";
export { ContextReader } from "./context/reader.js";
export type { ContextAuthorityScope, LoadedContext } from "./context/reader.js";
export { CONTEXT_ROLES } from "./context/types.js";
export type { ContextAdapterRequest, ContextAuthorityResolver, ContextDispatchExpectation, ContextEnvelope, ContextEnvelopeInput, ContextRole, PinnedLedgerReader, ProductShaReader } from "./context/types.js";

// Exact-SHA acceptance and independent-review evidence gate.
export { canonicalJson, validateAcceptanceEvidence, validateEvidenceManifest, validateFindingResolution, validateReviewRequest, validateReviewResult } from "./evidence/schema.js";
export { evaluateFreshness } from "./evidence/freshness.js";
export { EvidenceError } from "./evidence/errors.js";
export type { AcceptanceEvidence, AcceptanceItem, EvidenceDecision, EvidenceManifest, EvidenceState, FindingResolution, ReviewFinding, ReviewRequest, ReviewResult } from "./evidence/types.js";
export { createTrustedCodexReviewOperation } from "./review/factory.js";
export type { TrustedCodexReviewConfig, TrustedCodexReviewOperation, TrustedCodexReviewOperationDependencies } from "./review/factory.js";
export { ReviewError } from "./review/errors.js";
export { createTrustedAcceptanceGate } from "./acceptance/gate.js";
export type { EvidenceClock, TrustedAcceptanceGate, TrustedAcceptanceGateDependencies } from "./acceptance/gate.js";
export { createTrustedFindingResolutionWriter } from "./acceptance/resolution.js";
export type { FindingResolutionInput, TrustedFindingResolutionDependencies, TrustedFindingResolutionWriter } from "./acceptance/resolution.js";
export { evidencePath } from "./acceptance/ledger.js";
export { acceptanceStatusContributor } from "./acceptance/status.js";

// Command-scoped GitHub API and Git-transport boundaries.
export { GitHubAuthorityError, redactGitHubCredential } from "./github/errors.js";
export type { GitHubAuthorityErrorCode } from "./github/errors.js";
export type { GitHubApiCredential, GitHubApiCredentialResolver, GitHubRestClient, GitHubRestClientFactory, GitHubRestMethod, GitHubRestRequest, GitHubRestTransport, GitHubRestTransportRequest, GitHubRestTransportResponse } from "./github/types.js";
export { GitHubTrackerError, stableShipyardMarker } from "./github/markers.js";
export type { GitHubTrackerErrorCode } from "./github/markers.js";
export { trackDevelopmentRecords } from "./github/tracker.js";
export type { DevelopmentIssueCheckpoint, DevelopmentIssueRequest, DevelopmentPullRequestCheckpoint, DevelopmentPullRequestRequest, DevelopmentRecordAuthority, DevelopmentRecordRequest, DevelopmentRecordResume, DevelopmentRecordsCheckpoint } from "./github/tracker.js";
export { DevelopmentRecordGuard } from "./github/tracking-guard.js";
export { ActiveDevelopmentTrackingAuthorityResolver } from "./github/tracking-authority.js";
export type { DevelopmentTrackingAuthority, DevelopmentTrackingAuthorityResolver } from "./github/tracking-authority.js";
export { githubTrackerStatusContributor } from "./github/status.js";
export type { GitHubTrackerStatus } from "./github/status.js";
export { GitTransportError, GitTransportService, redactGitTransportDiagnostic } from "./github/git-transport.js";
export type { GitTransportCredential, GitTransportResult } from "./github/git-transport.js";

// Narrow baseline synchronization and read-only source-import contracts.
export { SyncError, SyncService, canonicalSourceRef } from "./sync/service.js";
export type { SyncErrorCode } from "./sync/errors.js";
export type { BaselineObservation, SyncGit, SyncMutationProof } from "./sync/git.js";
export type { SourceProvenance, SyncOutcome, SyncRequest } from "./sync/types.js";
export { syncStatusContributor } from "./sync/status.js";
export type { SyncStatus, SyncStatusReader, SyncStatusReadRequest } from "./sync/status.js";
export { DestinationSyncTransport, assertNoSourcePublication, requireSourceFreePublication } from "./sync/transport.js";
export type { GitTransportCredentialResolver, PublicationRequest, StagedDestination, SyncDestinationTransport, VerifiedGitTransportCredential } from "./sync/transport.js";
export { validateSourceProvenance } from "./sync/provenance.js";
