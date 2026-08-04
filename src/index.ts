export { CONTRACT_VERSION, DELIVERY_PHASES, OPERATIONS } from "./contracts/types.js";
export type { Binding, ContractVersion, DeliveryPhase, GitHubActor, LifecycleState, Operation, PathOwner, PathPolicy, PathRule, Profile, RemoteExpectation, RepositoryRef, SingleRepositoryTopology, StagedPairTopology, Topology } from "./contracts/types.js";
export { ContractValidationError, validateBinding, validateLifecycleState, validateOperation, validatePathPolicy, validateProfile, validateRemoteExpectation } from "./contracts/validate.js";
export type { ContractErrorCode } from "./contracts/errors.js";
export { composeStatus, createStatusProjection } from "./status/projection.js";
export type { StatusBlocker, StatusContributor, StatusProjection } from "./status/projection.js";

// Binding/core adapters are deliberately exported by interface, not by module internals.
export { nodeFilesystem } from "./adapters/filesystem.js";
export type { FilesystemAdapter } from "./adapters/filesystem.js";
export { nodeGit } from "./adapters/git.js";
export type { GitAdapter } from "./adapters/git.js";
export { nodeProcess } from "./adapters/process.js";
export type { ProcessAdapter } from "./adapters/process.js";
export { BindingError } from "./binding/errors.js";
export { BindingService, newBindingDocument, validateBoundRepository, validateRemotes, validateTopology } from "./binding/service.js";
export { JsonBindingStore } from "./binding/store.js";
export type { BindingDocument, BindingStore, RepositoryBinding, RepositoryTopology, TopologyKind } from "./binding/types.js";
export { PathPolicyError, classifyPath, classifyPaths } from "./policy/path-classifier.js";
export type { PathOwner as ClassifiedPathOwner, PathPolicy as ClassificationPathPolicy, PathRule as ClassificationPathRule } from "./policy/path-classifier.js";
export { MutationLockError, MutationLockService } from "./locking/mutation-lock.js";
export type { AcquiredMutationLock, MutationLockRecord } from "./locking/mutation-lock.js";
