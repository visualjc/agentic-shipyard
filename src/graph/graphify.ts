import { isAbsolute, join, resolve } from "node:path";
import { graphCacheIdentity, graphDecision, validateGraphBaseline, validateGraphDescriptor } from "./freshness.js";
import { graphPathContains } from "./validation.js";
import { snapshotGraphCommandResult } from "./command.js";
import { graphLockPath } from "./freshness.js";
import type { GraphCacheLock } from "./types.js";
import type { GraphBaseline, GraphDecision, GraphDescriptor, GraphSource } from "./types.js";

export const GRAPHIFY_RECEIPT = "graphify@0.9.32#00efd6e7969837ae4a9f11d8d504dcd3b20b09df";
export interface LocalGraphCommand { run(command: string, args: readonly string[], options: { cwd: string; env: Readonly<Record<string, string>> }): Promise<{ code: number }>; attest?(executable: string, receipt: string): Promise<unknown>; }
export interface GraphifyFiles { exists(path: string): Promise<boolean>; productGraphifyLeak(worktreeRoot: string): Promise<boolean>; canonicalPath(path: string): Promise<string | undefined>; copy?(from: string, to: string): Promise<void>; remove?(path: string): Promise<void>; }
export interface GraphOperationLock { acquire(path: string): Promise<{ decision?: GraphDecision; lock?: GraphCacheLock }>; release(path: string, lock: GraphCacheLock): Promise<void>; }
export interface GraphifyOptions { enabled: boolean; localOnlyApproved: boolean; reviewedToolSource: string; cacheRoot: string; executablePath?: string; now?(): Date; lock?: GraphOperationLock; command: LocalGraphCommand; files: GraphifyFiles; }
function executable(options: GraphifyOptions): string | undefined { return options.executablePath && isAbsolute(options.executablePath) && resolve(options.executablePath) === options.executablePath ? options.executablePath : undefined; }
async function attest(command: LocalGraphCommand, executable: string, receipt: string): Promise<boolean> { try { const result = snapshotGraphCommandResult(await command.attest?.(executable, receipt)); return result?.code === 0 && !result.timedOut && result.stderr === "" && result.stdout === receipt; } catch { return false; } }
async function locked<T>(options: GraphifyOptions, cacheRoot: string, identity: string, operation: () => Promise<T>): Promise<T | GraphDecision> {
  if (!options.lock) return operation();
  const path = graphLockPath(join(resolve(cacheRoot), "..", ".shipyard-graph-state"), identity); const acquired = await options.lock.acquire(path);
  if (!acquired.lock) return acquired.decision ?? graphDecision("blocked", "Graph cache lock could not be acquired.");
  try { const value = await operation(); await options.lock.release(path, acquired.lock); return value; }
  catch { try { await options.lock.release(path, acquired.lock); } catch {} return graphDecision("failed", "Graph operation failed or its lock release could not be verified."); }
}

/** Seed only an exact clean authoritative-main baseline into a new private cache. */
export async function seedGraphify(source: GraphSource, baseline: GraphBaseline, options: GraphifyOptions): Promise<{ decision: GraphDecision; descriptor?: GraphDescriptor }> {
  if (!options.enabled || !options.localOnlyApproved || options.reviewedToolSource !== GRAPHIFY_RECEIPT || !options.files.copy || !options.files.remove) return { decision: graphDecision(!options.enabled || !options.localOnlyApproved ? "disabled" : "invalid", "Graphify seed is not explicitly authorized or safely available.") };
  const binary = executable(options); if (!binary || !await attest(options.command, binary, GRAPHIFY_RECEIPT)) return { decision: graphDecision("unavailable", "Graphify executable attestation failed.") };
  const baselineDecision = validateGraphBaseline(source, baseline, "graphify", GRAPHIFY_RECEIPT);
  if (!baselineDecision.authoritative) return { decision: baselineDecision };
  if (!isAbsolute(options.cacheRoot)) return { decision: graphDecision("invalid", "Graphify cache root must be absolute.") };
  const cacheRoot = await options.files.canonicalPath(options.cacheRoot);
  const worktreeRoot = await options.files.canonicalPath(source.worktreeRoot);
  if (!cacheRoot || !worktreeRoot || resolve(worktreeRoot) !== source.worktreeRoot || resolve(cacheRoot) !== cacheRoot || graphPathContains(worktreeRoot, cacheRoot) || graphPathContains(cacheRoot, worktreeRoot) || await options.files.exists(cacheRoot)) return { decision: graphDecision("invalid", "Graphify seed cache must be a new canonical private external root.") };
  const output = join(cacheRoot, "graphify-out");
  try {
    const copied = await locked(options, cacheRoot, graphCacheIdentity("graphify", GRAPHIFY_RECEIPT, { ...source, worktreeRoot }, baseline.source.headSha), () => options.files.copy!(join(baseline.descriptor.cacheRoot, "graphify-out"), output));
    if (copied !== undefined) return { decision: copied };
    if (!await options.files.exists(output) || await options.files.productGraphifyLeak(worktreeRoot)) throw new Error("seed verification failed");
  } catch { try { await options.files.remove(cacheRoot); } catch {} return { decision: graphDecision("failed", "Graphify seed failed; partial private cache was discarded.") }; }
  const descriptor: GraphDescriptor = Object.freeze({ adapter: "graphify", reviewedToolSource: GRAPHIFY_RECEIPT, cacheIdentity: graphCacheIdentity("graphify", GRAPHIFY_RECEIPT, { ...source, worktreeRoot }, baseline.source.headSha), cacheRoot, worktreeRoot, worktreeInstanceId: source.worktreeInstanceId, indexedCommit: source.headSha, workingTreeFingerprint: source.workingTreeFingerprint, refreshedAt: options.now?.().toISOString() ?? "1970-01-01T00:00:00.000Z", seededFromSha: baseline.source.headSha });
  return { decision: validateGraphDescriptor({ ...source, worktreeRoot }, descriptor, "graphify", GRAPHIFY_RECEIPT), descriptor };
}

export async function refreshGraphify(source: GraphSource, options: GraphifyOptions): Promise<{ decision: GraphDecision; descriptor?: GraphDescriptor }> {
  if (!options.enabled || !options.localOnlyApproved) return { decision: graphDecision("disabled", "Graphify is experimental and requires an explicit local-only enabled profile.") };
  if (options.reviewedToolSource !== GRAPHIFY_RECEIPT) return { decision: graphDecision("invalid", "Graphify reviewed source receipt does not match the pinned adapter.") };
  const binary = executable(options); if (!binary) return { decision: graphDecision("unavailable", "Graphify requires an explicitly configured canonical executable.") };
  if (!await attest(options.command, binary, GRAPHIFY_RECEIPT)) return { decision: graphDecision("unavailable", "Graphify executable attestation failed.") };
  if (!isAbsolute(options.cacheRoot)) return { decision: graphDecision("invalid", "Graphify cache root must be an absolute private path.") };
  const cacheRoot = await options.files.canonicalPath(options.cacheRoot);
  const worktreeRoot = await options.files.canonicalPath(source.worktreeRoot);
  if (!cacheRoot || !worktreeRoot || resolve(worktreeRoot) !== source.worktreeRoot || resolve(cacheRoot) !== cacheRoot || !isAbsolute(cacheRoot) || graphPathContains(worktreeRoot, cacheRoot) || graphPathContains(cacheRoot, worktreeRoot)) return { decision: graphDecision("invalid", "Graphify output must be a canonical private external cache root.") };
  const output = join(cacheRoot, "graphify-out");
  const lockedResult = await locked(options, cacheRoot, graphCacheIdentity("graphify", options.reviewedToolSource, { ...source, worktreeRoot }), () => options.command.run(binary, ["index", "--code-only", "--out", output], { cwd: worktreeRoot, env: { GRAPHIFY_OUT: output, GRAPHIFY_QUERY_LOG_DISABLE: "1" } }));
  if ("state" in lockedResult) return { decision: lockedResult };
  const result = lockedResult;
  // Verify the known --out-only leak even after a command failure.
  const leaked = await options.files.productGraphifyLeak(worktreeRoot);
  if (result.code !== 0 || leaked || !await options.files.exists(output)) return { decision: graphDecision("failed", result.code !== 0 ? "Graphify refresh command failed." : "Graphify output relocation verification failed.") };
  const descriptor: GraphDescriptor = Object.freeze({ adapter: "graphify", reviewedToolSource: options.reviewedToolSource, cacheIdentity: graphCacheIdentity("graphify", options.reviewedToolSource, { ...source, worktreeRoot }), cacheRoot, worktreeRoot, worktreeInstanceId: source.worktreeInstanceId, indexedCommit: source.headSha, workingTreeFingerprint: source.workingTreeFingerprint, refreshedAt: options.now?.().toISOString() ?? "1970-01-01T00:00:00.000Z" });
  return { decision: validateGraphDescriptor(source, descriptor, "graphify", options.reviewedToolSource), descriptor };
}
