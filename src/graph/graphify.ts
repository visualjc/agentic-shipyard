import { isAbsolute, join, resolve } from "node:path";
import { graphCacheIdentity, graphDecision, graphOperationLockIdentity, validateGraphDescriptor } from "./freshness.js";
import { graphPathContains, validateGraphDecision as snapshotDecision, validateGraphLock as snapshotLock } from "./validation.js";
import { snapshotGraphCommandResult } from "./command.js";
import { graphLockPath } from "./freshness.js";
import type { GraphCacheLock } from "./types.js";
import { consumeGraphSeedAuthorization, type GraphSeedAuthorization } from "./baseline.js";
import type { GraphBaseline, GraphDecision, GraphDescriptor, GraphSource } from "./types.js";
import { snapshotGraphSource, type GraphSourceReader } from "./fingerprint.js";
import { observeGraphArtifact, type GraphArtifactExpectation, type GraphExecutableObservation } from "./artifact.js";

export { snapshotGraphExecutableObservation } from "./artifact.js";
export type { GraphArtifactExpectation, GraphExecutableObservation } from "./artifact.js";

export const GRAPHIFY_RECEIPT = "graphify@0.9.32#00efd6e7969837ae4a9f11d8d504dcd3b20b09df";
/** Commands and observations are untrusted ports: every receipt is snapshotted before use. */
export interface LocalGraphCommand { run(command: string, args: readonly string[], options: { cwd: string; env: Readonly<Record<string, string>>; artifact: GraphExecutableObservation }): Promise<unknown>; observe(executable: string, expectation: GraphArtifactExpectation): Promise<unknown>; }
export interface GraphifyFiles { exists(path: string): Promise<boolean>; productGraphifyLeak(worktreeRoot: string): Promise<boolean>; canonicalPath(path: string): Promise<string | undefined>; contentDigest(path: string): Promise<string>; copy?(from: string, to: string): Promise<void>; remove?(path: string): Promise<void>; }
export interface GraphOperationLock { acquire(path: string): Promise<{ decision?: GraphDecision; lock?: GraphCacheLock }>; release(path: string, lock: GraphCacheLock): Promise<void>; }
export interface GraphDescriptorPublisher { write(descriptor: GraphDescriptor): Promise<void>; remove(): Promise<void>; }
export interface GraphifyOptions { enabled: boolean; localOnlyApproved: boolean; reviewedToolSource: string; artifactSha256?: string; cacheRoot: string; executablePath?: string; now?(): Date; lock?: GraphOperationLock; sourceReader?: GraphSourceReader; descriptorPublisher?: GraphDescriptorPublisher; command: LocalGraphCommand; files: GraphifyFiles; }
function plain(value: unknown): Record<string, unknown> | undefined { try { if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return undefined; const d = Object.getOwnPropertyDescriptors(value); if (Object.values(d).some((x) => !("value" in x))) return undefined; return Object.fromEntries(Object.entries(d).map(([k, x]) => [k, x.value])); } catch { return undefined; } }
function executable(value: unknown): string | undefined { return typeof value === "string" && isAbsolute(value) && resolve(value) === value ? value : undefined; }
function successful(value: unknown): boolean { const result = snapshotGraphCommandResult(value); return !!result && result.code === 0 && !result.timedOut && result.stderr === ""; }
export async function withGraphOperationLock<T extends { decision: GraphDecision }>(lock: GraphOperationLock | undefined, cacheRoot: string, identity: string, operation: () => Promise<T>, lockStateRoot = join(resolve(cacheRoot), "..", ".shipyard-graph-state"), rollback?: () => Promise<void>): Promise<T | GraphDecision> {
  if (!lock) return graphDecision("blocked", "Enabled graph operations require a verified GraphOperationLock.");
  const path = graphLockPath(lockStateRoot, identity); let acquired;
  try { acquired = await lock.acquire(path); } catch { return graphDecision("blocked", "Graph cache lock acquisition failed safely."); }
  let owner: GraphCacheLock | undefined, denied: GraphDecision | undefined;
  try { const value = plain(acquired); if (!value || Object.keys(value).some(key => key !== "decision" && key !== "lock")) throw new Error(); owner = value.lock === undefined ? undefined : snapshotLock(value.lock); denied = value.decision === undefined ? undefined : snapshotDecision(value.decision); if (owner && denied) throw new Error(); } catch { return graphDecision("blocked", "Graph cache lock response was invalid."); }
  if (!owner) return denied ?? graphDecision("blocked", "Graph cache lock could not be acquired.");
  let value: T, rollbackAttempted = false, rollbackClean = true;
  const undo = async (): Promise<boolean> => { if (!rollback || rollbackAttempted) return rollbackClean; rollbackAttempted = true; try { await rollback(); } catch { rollbackClean = false; } return rollbackClean; };
  try { value = await operation(); if (!value.decision.authoritative && !await undo()) throw new Error(); }
  catch { const clean = await undo(); let released = true; try { await lock.release(path, owner); } catch { released = false; } return graphDecision("failed", !clean ? "Graph descriptor rollback failed safely." : !released ? "Graph lock release could not be verified." : "Graph operation failed safely."); }
  try { await lock.release(path, owner); }
  catch { return graphDecision("failed", await undo() ? "Graph lock release could not be verified." : "Graph descriptor rollback failed safely."); }
  return value;
}

/** Seed only an exact clean authoritative-main baseline into a new private cache. */
export async function seedGraphify(source: GraphSource, authorization: GraphSeedAuthorization, options: GraphifyOptions): Promise<{ decision: GraphDecision; descriptor?: GraphDescriptor }> {
  const authorized = consumeGraphSeedAuthorization(authorization); if (!authorized) return { decision: graphDecision("invalid", "Graphify seed requires live Git baseline authorization.") };
  try { const target = (await import("./validation.js")).validateGraphSource(source); if (JSON.stringify(target) !== JSON.stringify(authorized.featureSource) || authorized.baseline.descriptor.adapter !== "graphify" || authorized.baseline.descriptor.reviewedToolSource !== GRAPHIFY_RECEIPT || authorized.baseline.descriptor.artifactSha256 !== options.artifactSha256) return { decision: graphDecision("invalid", "Graph seed authorization does not match this exact adapter, artifact, and feature source.") }; return await operateGraphify(target, options, authorized.baseline); } catch { return { decision: graphDecision("failed", "Graphify seed boundary failed safely.") }; }
}

export async function refreshGraphify(source: GraphSource, options: GraphifyOptions): Promise<{ decision: GraphDecision; descriptor?: GraphDescriptor }> {
  try { return await operateGraphify(source, options); } catch { return { decision: graphDecision("failed", "Graphify refresh boundary failed safely.") }; }
}

async function operateGraphify(inputSource: GraphSource, inputOptions: GraphifyOptions, baseline?: GraphBaseline): Promise<{ decision: GraphDecision; descriptor?: GraphDescriptor }> {
  const options = plain(inputOptions); if (!options || typeof options.enabled !== "boolean" || typeof options.localOnlyApproved !== "boolean" || typeof options.reviewedToolSource !== "string" || typeof options.cacheRoot !== "string" || !options.command || !options.files) return { decision: graphDecision("invalid", "Graphify options are invalid.") };
  if (!options.enabled || !options.localOnlyApproved) return { decision: graphDecision("disabled", "Graphify is experimental and requires an explicit local-only enabled profile.") };
  const sourceDecision = validateGraphDescriptor(inputSource, undefined, "graphify", GRAPHIFY_RECEIPT); if (sourceDecision.state === "invalid") return { decision: sourceDecision };
  const source = (await import("./validation.js")).validateGraphSource(inputSource); const binary = executable(options.executablePath);
  if (options.reviewedToolSource !== GRAPHIFY_RECEIPT || typeof options.artifactSha256 !== "string" || !/^[0-9a-f]{64}$/.test(options.artifactSha256) || !binary || !options.lock || !options.sourceReader || !options.files || !options.command || !isAbsolute(options.cacheRoot)) return { decision: graphDecision("invalid", "Graphify enabled operation lacks a guarded local boundary.") };
  const fileValues = plain(options.files), commandValues = plain(options.command), readerValues = plain(options.sourceReader), lockValues = plain(options.lock), publisherValues = options.descriptorPublisher === undefined ? undefined : plain(options.descriptorPublisher);
  if (!fileValues || !commandValues || !readerValues || !lockValues || typeof fileValues.canonicalPath !== "function" || typeof fileValues.exists !== "function" || typeof fileValues.productGraphifyLeak !== "function" || typeof fileValues.contentDigest !== "function" || typeof commandValues.observe !== "function" || typeof commandValues.run !== "function" || typeof readerValues.canonicalWorktree !== "function" || typeof readerValues.worktreeInstanceId !== "function" || typeof readerValues.headSha !== "function" || typeof readerValues.worktreeStatus !== "function" || typeof lockValues.acquire !== "function" || typeof lockValues.release !== "function" || (publisherValues && (typeof publisherValues.write !== "function" || typeof publisherValues.remove !== "function"))) return { decision: graphDecision("invalid", "Graphify guarded ports are invalid.") };
  const files = fileValues as unknown as GraphifyFiles; const command = commandValues as unknown as LocalGraphCommand; const reader = readerValues as unknown as GraphSourceReader; const operationLock = lockValues as unknown as GraphOperationLock;
  const cacheRoot = await files.canonicalPath(options.cacheRoot); const worktreeRoot = await files.canonicalPath(source.worktreeRoot);
  if (!cacheRoot || !worktreeRoot || resolve(worktreeRoot) !== source.worktreeRoot || resolve(cacheRoot) !== cacheRoot || graphPathContains(worktreeRoot, cacheRoot) || graphPathContains(cacheRoot, worktreeRoot)) return { decision: graphDecision("invalid", "Graphify output must be a canonical private external cache root.") };
  const seedSha = baseline ? (baseline as GraphBaseline).source.headSha : undefined; const identity = graphCacheIdentity("graphify", GRAPHIFY_RECEIPT, { ...source, worktreeRoot }, seedSha); const lockIdentity = graphOperationLockIdentity("graphify", GRAPHIFY_RECEIPT, { ...source, worktreeRoot });
  const outcome = await withGraphOperationLock(operationLock, cacheRoot, lockIdentity, async () => {
    const observation = await observeGraphArtifact(command, binary, GRAPHIFY_RECEIPT, options.artifactSha256 as string); if (!observation) return { decision: graphDecision("unavailable", "Graphify executable artifact verification failed.") };
    if (baseline) {
      if (!files.copy || !files.remove || await files.exists(cacheRoot)) return { decision: graphDecision("invalid", "Graphify seed cache must be new.") };
      const output = join(cacheRoot, "graphify-out");
      try { await files.copy(join(baseline.descriptor.cacheRoot, "graphify-out"), output); if (!await files.exists(output) || await files.productGraphifyLeak(worktreeRoot)) throw new Error(); }
      catch { try { await files.remove(cacheRoot); } catch {} return { decision: graphDecision("failed", "Graphify seed verification failed.") }; }
    } else {
      const output = join(cacheRoot, "graphify-out"); const result = await command.run(binary, ["index", "--code-only", "--out", output], { cwd: worktreeRoot, env: { GRAPHIFY_OUT: output, GRAPHIFY_QUERY_LOG_DISABLE: "1" }, artifact: observation }); if (!successful(result) || await files.productGraphifyLeak(worktreeRoot) || !await files.exists(output)) return { decision: graphDecision("failed", "Graphify refresh verification failed.") };
    }
    let after: GraphSource, contentSha256: string; try { contentSha256 = await files.contentDigest(join(cacheRoot, "graphify-out")); after = await snapshotGraphSource(reader, worktreeRoot); } catch { return { decision: graphDecision("stale", "Graph content/source cannot be verified after operation.") }; }
    if (!/^[0-9a-f]{64}$/.test(contentSha256)) return { decision: graphDecision("failed", "Graphify content provenance is invalid.") };
    if (baseline && contentSha256 !== baseline.descriptor.contentSha256) { try { await files.remove!(cacheRoot); } catch { return { decision: graphDecision("failed", "Graphify authorized seed cleanup failed safely.") }; } return { decision: graphDecision("invalid", "Graphify seed bytes no longer match the authorized main cache.") }; }
    if (after.headSha !== source.headSha || after.workingTreeFingerprint !== source.workingTreeFingerprint || after.worktreeInstanceId !== source.worktreeInstanceId || after.worktreeRoot !== source.worktreeRoot) return { decision: graphDecision("stale", "Graph source changed while operation ran.") };
    const descriptor: GraphDescriptor = Object.freeze({ adapter: "graphify", reviewedToolSource: GRAPHIFY_RECEIPT, artifactSha256: options.artifactSha256 as string, contentSha256, cacheIdentity: identity, cacheRoot, worktreeRoot, worktreeInstanceId: source.worktreeInstanceId, indexedCommit: source.headSha, workingTreeFingerprint: source.workingTreeFingerprint, refreshedAt: typeof options.now === "function" ? (options.now as () => Date)().toISOString() : "1970-01-01T00:00:00.000Z", ...(seedSha ? { seededFromSha: seedSha } : {}) });
    const decision = validateGraphDescriptor(after, descriptor, "graphify", GRAPHIFY_RECEIPT, options.artifactSha256 as string); if (!decision.authoritative) return { decision };
    if (publisherValues) await (publisherValues as unknown as GraphDescriptorPublisher).write(descriptor);
    return { decision, descriptor };
  }, undefined, publisherValues ? () => (publisherValues as unknown as GraphDescriptorPublisher).remove() : undefined);
  return "state" in outcome ? { decision: outcome } : outcome;
}
