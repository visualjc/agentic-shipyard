export { CONTRACT_VERSION, DELIVERY_PHASES, OPERATIONS } from "./contracts/types.js";
export type { Binding, ContractVersion, DeliveryPhase, GitHubActor, LifecycleState, Operation, PathOwner, PathPolicy, PathRule, Profile, RemoteExpectation, RepositoryRef, SingleRepositoryTopology, StagedPairTopology, Topology } from "./contracts/types.js";
export { ContractValidationError, validateBinding, validateLifecycleState, validateOperation, validatePathPolicy, validateProfile, validateRemoteExpectation } from "./contracts/validate.js";
export type { ContractErrorCode } from "./contracts/errors.js";
export { composeStatus, createStatusProjection } from "./status/projection.js";
export type { StatusBlocker, StatusContributor, StatusProjection } from "./status/projection.js";

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
export type { DeliveryRegistry, DeliveryRegistryDocument, DeliveryResolutionRequest, DeliveryWorkspace, ResolvedDelivery } from "./delivery/types.js";
export { LedgerError } from "./ledger/errors.js";
export type { LedgerFailureCode } from "./ledger/errors.js";
export { applyLedgerTransaction, validLedgerPath } from "./ledger/transaction.js";
export type { LedgerSnapshot, LedgerStore, LedgerTransaction, LedgerWrite } from "./ledger/types.js";
export { GitLedgerStore } from "./adapters/ledger-git.js";
export { WorkspaceError } from "./workspace/errors.js";
export type { WorkspaceFailureCode } from "./workspace/errors.js";
export { WorkspaceService, nodeWorkspaceGit } from "./workspace/service.js";
export type { CreateOrResumeDelivery, InitialDeliveryLedgerRecord, WorkspaceGit, WorkspaceGitIdentity } from "./workspace/service.js";

// Role-limited, exact-SHA worker context.
export { ContextError } from "./context/errors.js";
export type { ContextFailureCode } from "./context/errors.js";
export { allowedRecordPaths, createEnvelope, validateContextEnvelope } from "./context/envelope.js";
export { ContextReader } from "./context/reader.js";
export type { LoadedContext } from "./context/reader.js";
export { CONTEXT_ROLES } from "./context/types.js";
export type { ContextAdapterRequest, ContextDispatchExpectation, ContextEnvelope, ContextEnvelopeInput, ContextRole, PinnedLedgerReader, ProductShaReader } from "./context/types.js";

// Command-scoped GitHub API and Git-transport boundaries.
export { GitHubAuthorityError, redactGitHubCredential } from "./github/errors.js";
export type { GitHubAuthorityErrorCode } from "./github/errors.js";
export { verifyGitHubActor } from "./github/authority.js";
export { GitHubRestAdapter } from "./adapters/github-rest.js";
export type { GitHubApiCredential, GitHubApiCredentialResolver, GitHubRestClient, GitHubRestClientFactory, GitHubRestMethod, GitHubRestRequest, GitHubRestTransport, GitHubRestTransportRequest, GitHubRestTransportResponse, VerifiedGitHubSession } from "./github/types.js";
export { GitHubTrackerError, stableShipyardMarker } from "./github/markers.js";
export type { GitHubTrackerErrorCode } from "./github/markers.js";
export { trackDevelopmentRecords } from "./github/tracker.js";
export type { DevelopmentIssueCheckpoint, DevelopmentIssueRequest, DevelopmentPullRequestCheckpoint, DevelopmentPullRequestRequest, DevelopmentRecordAuthority, DevelopmentRecordMutationGuard, DevelopmentRecordRequest, DevelopmentRecordResume, DevelopmentRecordsCheckpoint } from "./github/tracker.js";
export { githubTrackerStatusContributor } from "./github/status.js";
export type { GitHubTrackerStatus } from "./github/status.js";
export { GitTransportError, GitTransportService, redactGitTransportDiagnostic } from "./github/git-transport.js";
export type { GitTransportCredential, GitTransportResult } from "./github/git-transport.js";
export { createNodeGitTransportCommandRunner, DEFAULT_NODE_GIT_EXECUTABLE, nodeGitTransportCommandRunner } from "./adapters/git-transport.js";
export type { GitTransportCommand, GitTransportCommandResult, GitTransportCommandRunner } from "./adapters/git-transport.js";
