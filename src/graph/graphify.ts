import { isAbsolute, join, resolve } from "node:path";
import { graphCacheIdentity, graphDecision, validateGraphBaseline, validateGraphDescriptor } from "./freshness.js";
import { graphPathContains } from "./validation.js";
import { snapshotGraphCommandResult } from "./command.js";
import { graphLockPath } from "./freshness.js";
import type { GraphCacheLock } from "./types.js";
import type { GraphBaseline, GraphDecision, GraphDescriptor, GraphSource } from "./types.js";
import { snapshotGraphSource, type GraphSourceReader } from "./fingerprint.js";

export const GRAPHIFY_RECEIPT = "graphify@0.9.32#00efd6e7969837ae4a9f11d8d504dcd3b20b09df";
export interface GraphExecutableObservation { executable: string; version: string; sourceReceipt: string; }
/** Commands and observations are untrusted ports: every receipt is snapshotted before use. */
export interface LocalGraphCommand { run(command: string, args: readonly string[], options: { cwd: string; env: Readonly<Record<string, string>> }): Promise<unknown>; observe(executable: string): Promise<unknown>; }
export interface GraphifyFiles { exists(path: string): Promise<boolean>; productGraphifyLeak(worktreeRoot: string): Promise<boolean>; canonicalPath(path: string): Promise<string | undefined>; copy?(from: string, to: string): Promise<void>; remove?(path: string): Promise<void>; }
export interface GraphOperationLock { acquire(path: string): Promise<{ decision?: GraphDecision; lock?: GraphCacheLock }>; release(path: string, lock: GraphCacheLock): Promise<void>; }
export interface GraphifyOptions { enabled: boolean; localOnlyApproved: boolean; reviewedToolSource: string; cacheRoot: string; executablePath?: string; now?(): Date; lock?: GraphOperationLock; sourceReader?: GraphSourceReader; command: LocalGraphCommand; files: GraphifyFiles; }
function plain(value: unknown): Record<string, unknown> | undefined { try { if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return undefined; const d = Object.getOwnPropertyDescriptors(value); if (Object.values(d).some((x) => !("value" in x))) return undefined; return Object.fromEntries(Object.entries(d).map(([k, x]) => [k, x.value])); } catch { return undefined; } }
function executable(value: unknown): string | undefined { return typeof value === "string" && isAbsolute(value) && resolve(value) === value ? value : undefined; }
export function snapshotGraphExecutableObservation(value: unknown): Readonly<GraphExecutableObservation> | undefined { const v = plain(value); if (!v || Object.keys(v).length !== 3 || typeof v.executable !== "string" || typeof v.version !== "string" || typeof v.sourceReceipt !== "string" || Buffer.byteLength(v.executable) > 4096 || Buffer.byteLength(v.version) > 256 || Buffer.byteLength(v.sourceReceipt) > 512) return undefined; return Object.freeze({ executable: v.executable, version: v.version, sourceReceipt: v.sourceReceipt }); }
async function observed(command: LocalGraphCommand, executablePath: string, expectedReceipt: string): Promise<boolean> { try { const observation = snapshotGraphExecutableObservation(await command.observe(executablePath)); return observation?.executable === executablePath && observation.sourceReceipt === expectedReceipt && observation.version.length > 0; } catch { return false; } }
function successful(value: unknown): boolean { const result = snapshotGraphCommandResult(value); return !!result && result.code === 0 && !result.timedOut && result.stderr === ""; }
export async function withGraphOperationLock<T>(lock: GraphOperationLock | undefined, cacheRoot: string, identity: string, operation: () => Promise<T>, lockStateRoot = join(resolve(cacheRoot), "..", ".shipyard-graph-state")): Promise<T | GraphDecision> {
  if (!lock) return graphDecision("blocked", "Enabled graph operations require a verified GraphOperationLock.");
  const path = graphLockPath(lockStateRoot, identity); const acquired = await lock.acquire(path);
  if (!acquired.lock) return acquired.decision ?? graphDecision("blocked", "Graph cache lock could not be acquired.");
  try { const value = await operation(); await lock.release(path, acquired.lock); return value; }
  catch { try { await lock.release(path, acquired.lock); } catch {} return graphDecision("failed", "Graph operation failed or its lock release could not be verified."); }
}

/** Seed only an exact clean authoritative-main baseline into a new private cache. */
export async function seedGraphify(source: GraphSource, baseline: GraphBaseline, options: GraphifyOptions): Promise<{ decision: GraphDecision; descriptor?: GraphDescriptor }> {
  return operateGraphify(source, options, baseline);
}

export async function refreshGraphify(source: GraphSource, options: GraphifyOptions): Promise<{ decision: GraphDecision; descriptor?: GraphDescriptor }> {
  return operateGraphify(source, options);
}

async function operateGraphify(inputSource: GraphSource, inputOptions: GraphifyOptions, baseline?: GraphBaseline): Promise<{ decision: GraphDecision; descriptor?: GraphDescriptor }> {
  const options = plain(inputOptions); if (!options || typeof options.enabled !== "boolean" || typeof options.localOnlyApproved !== "boolean" || typeof options.reviewedToolSource !== "string" || typeof options.cacheRoot !== "string" || !options.command || !options.files) return { decision: graphDecision("invalid", "Graphify options are invalid.") };
  if (!options.enabled || !options.localOnlyApproved) return { decision: graphDecision("disabled", "Graphify is experimental and requires an explicit local-only enabled profile.") };
  const sourceDecision = validateGraphDescriptor(inputSource, undefined, "graphify", GRAPHIFY_RECEIPT); if (sourceDecision.state === "invalid") return { decision: sourceDecision };
  const source = (await import("./validation.js")).validateGraphSource(inputSource); const binary = executable(options.executablePath);
  if (options.reviewedToolSource !== GRAPHIFY_RECEIPT || !binary || !options.lock || !options.sourceReader || !options.files || !options.command || !isAbsolute(options.cacheRoot)) return { decision: graphDecision("invalid", "Graphify enabled operation lacks a guarded local boundary.") };
  const files = options.files as GraphifyFiles; const command = options.command as LocalGraphCommand; const reader = options.sourceReader as GraphSourceReader;
  const cacheRoot = await files.canonicalPath(options.cacheRoot); const worktreeRoot = await files.canonicalPath(source.worktreeRoot);
  if (!cacheRoot || !worktreeRoot || resolve(worktreeRoot) !== source.worktreeRoot || resolve(cacheRoot) !== cacheRoot || graphPathContains(worktreeRoot, cacheRoot) || graphPathContains(cacheRoot, worktreeRoot)) return { decision: graphDecision("invalid", "Graphify output must be a canonical private external cache root.") };
  const seedSha = baseline ? (baseline as GraphBaseline).source.headSha : undefined; const identity = graphCacheIdentity("graphify", GRAPHIFY_RECEIPT, { ...source, worktreeRoot }, seedSha);
  const outcome = await withGraphOperationLock(options.lock as GraphOperationLock, cacheRoot, identity, async () => {
    if (!await observed(command, binary, GRAPHIFY_RECEIPT)) return { decision: graphDecision("unavailable", "Graphify executable observation failed.") };
    if (baseline) {
      const check = validateGraphBaseline(source, baseline, "graphify", GRAPHIFY_RECEIPT);
      if (!check.authoritative || !files.copy || !files.remove || await files.exists(cacheRoot)) return { decision: check.authoritative ? graphDecision("invalid", "Graphify seed cache must be new.") : check };
      const output = join(cacheRoot, "graphify-out");
      try { await files.copy(join(baseline.descriptor.cacheRoot, "graphify-out"), output); if (!await files.exists(output) || await files.productGraphifyLeak(worktreeRoot)) throw new Error(); }
      catch { try { await files.remove(cacheRoot); } catch {} return { decision: graphDecision("failed", "Graphify seed verification failed.") }; }
    } else {
      const output = join(cacheRoot, "graphify-out"); const result = await command.run(binary, ["index", "--code-only", "--out", output], { cwd: worktreeRoot, env: { GRAPHIFY_OUT: output, GRAPHIFY_QUERY_LOG_DISABLE: "1" } }); if (!successful(result) || await files.productGraphifyLeak(worktreeRoot) || !await files.exists(output)) return { decision: graphDecision("failed", "Graphify refresh verification failed.") };
    }
    let after: GraphSource; try { after = await snapshotGraphSource(reader, worktreeRoot); } catch { return { decision: graphDecision("stale", "Graph source cannot be reread after operation.") }; }
    if (after.headSha !== source.headSha || after.workingTreeFingerprint !== source.workingTreeFingerprint || after.worktreeInstanceId !== source.worktreeInstanceId) return { decision: graphDecision("stale", "Graph source changed while operation ran.") };
    const descriptor: GraphDescriptor = Object.freeze({ adapter: "graphify", reviewedToolSource: GRAPHIFY_RECEIPT, cacheIdentity: identity, cacheRoot, worktreeRoot, worktreeInstanceId: source.worktreeInstanceId, indexedCommit: source.headSha, workingTreeFingerprint: source.workingTreeFingerprint, refreshedAt: typeof options.now === "function" ? (options.now as () => Date)().toISOString() : "1970-01-01T00:00:00.000Z", ...(seedSha ? { seededFromSha: seedSha } : {}) }); return { decision: validateGraphDescriptor(after, descriptor, "graphify", GRAPHIFY_RECEIPT), descriptor };
  });
  return "state" in outcome ? { decision: outcome } : outcome;
}
