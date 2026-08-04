import { isAbsolute, join, resolve } from "node:path";
import { graphCacheIdentity, graphDecision, validateGraphBaseline, validateGraphDescriptor } from "./freshness.js";
import type { GraphBaseline, GraphDecision, GraphDescriptor, GraphSource } from "./types.js";
import type { LocalGraphCommand } from "./graphify.js";
import type { GraphOperationLock } from "./graphify.js";
import { graphLockPath } from "./freshness.js";
import { snapshotGraphCommandResult } from "./command.js";

export const CODEGRAPH_RECEIPT = "codegraph@1.5.0#49c11fc2e0c02170742be8411e66a31af611f4b7";
export interface CodeGraphFiles { excluded(path: string, entry: string): Promise<boolean>; addMachineLocalExclude(path: string, entry: string): Promise<void>; tracked(path: string): Promise<boolean>; exists(path: string): Promise<boolean>; canonicalPath(path: string): Promise<string | undefined>; copy?(from: string, to: string): Promise<void>; remove?(path: string): Promise<void>; }
export interface CodeGraphOptions { enabled: boolean; localOnlyApproved: boolean; reviewedToolSource: string; nodeExecutablePath?: string; codegraphExecutablePath?: string; now?(): Date; lock?: GraphOperationLock; command: LocalGraphCommand; files: CodeGraphFiles; }
function binary(path: string | undefined): string | undefined { return path && isAbsolute(path) && resolve(path) === path ? path : undefined; }
async function attest(command: LocalGraphCommand, executable: string, receipt: string): Promise<boolean> { try { const result = snapshotGraphCommandResult(await command.attest?.(executable, receipt)); return result?.code === 0 && !result.timedOut && result.stderr === "" && result.stdout === receipt; } catch { return false; } }
async function locked<T>(options: CodeGraphOptions, source: GraphSource, operation: () => Promise<T>): Promise<T | GraphDecision> {
  if (!options.lock) return operation();
  const identity = graphCacheIdentity("codegraph", options.reviewedToolSource, source);
  const path = graphLockPath(join(resolve(source.worktreeRoot), "..", ".shipyard-graph-state"), identity); const acquired = await options.lock.acquire(path);
  if (!acquired.lock) return acquired.decision ?? graphDecision("blocked", "Graph cache lock could not be acquired.");
  try { const value = await operation(); await options.lock.release(path, acquired.lock); return value; }
  catch { try { await options.lock.release(path, acquired.lock); } catch {} return graphDecision("failed", "Graph operation failed or its lock release could not be verified."); }
}

/** Empirical seed at the reviewed pin only; it is not an upstream-supported cache contract. */
export async function seedCodeGraph(source: GraphSource, baseline: GraphBaseline, options: CodeGraphOptions): Promise<{ decision: GraphDecision; descriptor?: GraphDescriptor }> {
  if (!options.enabled || !options.localOnlyApproved || options.reviewedToolSource !== CODEGRAPH_RECEIPT || !options.files.copy || !options.files.remove) return { decision: graphDecision(!options.enabled || !options.localOnlyApproved ? "disabled" : "invalid", "Empirical CodeGraph seed is not explicitly authorized or safely available.") };
  const node = binary(options.nodeExecutablePath); const codegraph = binary(options.codegraphExecutablePath);
  if (!node || !codegraph) return { decision: graphDecision("unavailable", "CodeGraph requires canonical configured runtime and executable.") };
  if (!await attest(options.command, node, "node:sqlite-fts5") || !await attest(options.command, codegraph, CODEGRAPH_RECEIPT)) return { decision: graphDecision("unavailable", "CodeGraph executable attestation failed.") };
  const baselineDecision = validateGraphBaseline(source, baseline, "codegraph", CODEGRAPH_RECEIPT);
  if (!baselineDecision.authoritative) return { decision: baselineDecision };
  const probe = await locked(options, source, () => options.command.run(node, ["--experimental-sqlite", "-e", "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');d.exec('CREATE VIRTUAL TABLE x USING fts5(v)')"], { cwd: source.worktreeRoot, env: { CODEGRAPH_TELEMETRY: "0" } }));
  if ("state" in probe) return { decision: probe };
  if (probe.code !== 0) return { decision: graphDecision("unavailable", "Selected Node runtime cannot create an SQLite FTS5 table.") };
  const worktreeRoot = await options.files.canonicalPath(source.worktreeRoot);
  const cacheRoot = worktreeRoot && await options.files.canonicalPath(join(worktreeRoot, ".codegraph"));
  const expectedCache = worktreeRoot && join(worktreeRoot, ".codegraph");
  if (!worktreeRoot || !cacheRoot || worktreeRoot !== source.worktreeRoot || cacheRoot !== expectedCache || await options.files.exists(cacheRoot)) return { decision: graphDecision("invalid", "CodeGraph seed cache must be a new canonical worktree-local .codegraph root.") };
  await options.files.addMachineLocalExclude(source.worktreeRoot, ".codegraph/");
  if (!await options.files.excluded(source.worktreeRoot, ".codegraph/") || await options.files.tracked(cacheRoot)) return { decision: graphDecision("failed", "CodeGraph cache exclusion is absent or cache is tracked.") };
  try {
    const copied = await locked(options, source, () => options.files.copy!(baseline.descriptor.cacheRoot, cacheRoot));
    if (copied !== undefined) return { decision: copied };
    if (!await options.files.exists(cacheRoot) || await options.files.tracked(cacheRoot)) throw new Error("seed verification failed");
  } catch { try { await options.files.remove(cacheRoot); } catch {} return { decision: graphDecision("failed", "CodeGraph seed failed; partial worktree cache was discarded.") }; }
  const descriptor: GraphDescriptor = Object.freeze({ adapter: "codegraph", reviewedToolSource: CODEGRAPH_RECEIPT, cacheIdentity: graphCacheIdentity("codegraph", CODEGRAPH_RECEIPT, source, baseline.source.headSha), cacheRoot, worktreeRoot: source.worktreeRoot, worktreeInstanceId: source.worktreeInstanceId, indexedCommit: source.headSha, workingTreeFingerprint: source.workingTreeFingerprint, refreshedAt: options.now?.().toISOString() ?? "1970-01-01T00:00:00.000Z", seededFromSha: baseline.source.headSha });
  return { decision: validateGraphDescriptor(source, descriptor, "codegraph", CODEGRAPH_RECEIPT), descriptor };
}

export async function refreshCodeGraph(source: GraphSource, options: CodeGraphOptions): Promise<{ decision: GraphDecision; descriptor?: GraphDescriptor }> {
  if (!options.enabled || !options.localOnlyApproved) return { decision: graphDecision("disabled", "CodeGraph is experimental and requires an explicit local-only enabled profile.") };
  if (options.reviewedToolSource !== CODEGRAPH_RECEIPT) return { decision: graphDecision("invalid", "CodeGraph reviewed source receipt does not match the pinned adapter.") };
  const node = binary(options.nodeExecutablePath); const codegraph = binary(options.codegraphExecutablePath); if (!node || !codegraph) return { decision: graphDecision("unavailable", "CodeGraph requires canonical configured runtime and executable.") };
  if (!await attest(options.command, node, "node:sqlite-fts5") || !await attest(options.command, codegraph, CODEGRAPH_RECEIPT)) return { decision: graphDecision("unavailable", "CodeGraph executable attestation failed.") };
  // Version text is insufficient: this actual local FTS5 probe is mandatory before any init/refresh.
  const probe = await locked(options, source, () => options.command.run(node, ["--experimental-sqlite", "-e", "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');d.exec('CREATE VIRTUAL TABLE x USING fts5(v)')"], { cwd: source.worktreeRoot, env: { CODEGRAPH_TELEMETRY: "0" } }));
  if ("state" in probe) return { decision: probe };
  if (probe.code !== 0) return { decision: graphDecision("unavailable", "Selected Node runtime cannot create an SQLite FTS5 table.") };
  const worktreeRoot = await options.files.canonicalPath(source.worktreeRoot);
  const cacheRoot = worktreeRoot && await options.files.canonicalPath(join(worktreeRoot, ".codegraph"));
  const expectedCache = worktreeRoot && join(worktreeRoot, ".codegraph");
  if (!worktreeRoot || !cacheRoot || worktreeRoot !== source.worktreeRoot || cacheRoot !== expectedCache) return { decision: graphDecision("invalid", "CodeGraph cache must be exactly the canonical worktree .codegraph root.") };
  await options.files.addMachineLocalExclude(source.worktreeRoot, ".codegraph/");
  if (!await options.files.excluded(source.worktreeRoot, ".codegraph/") || await options.files.tracked(cacheRoot)) return { decision: graphDecision("failed", "CodeGraph cache exclusion is absent or cache is tracked.") };
  const refreshed = await locked(options, source, () => options.command.run(codegraph, ["index"], { cwd: source.worktreeRoot, env: { CODEGRAPH_TELEMETRY: "0" } }));
  if ("state" in refreshed) return { decision: refreshed };
  if (refreshed.code !== 0 || !await options.files.exists(cacheRoot)) return { decision: graphDecision("failed", "CodeGraph refresh command failed or created no cache.") };
  const descriptor: GraphDescriptor = Object.freeze({ adapter: "codegraph", reviewedToolSource: options.reviewedToolSource, cacheIdentity: graphCacheIdentity("codegraph", options.reviewedToolSource, source), cacheRoot, worktreeRoot: source.worktreeRoot, worktreeInstanceId: source.worktreeInstanceId, indexedCommit: source.headSha, workingTreeFingerprint: source.workingTreeFingerprint, refreshedAt: options.now?.().toISOString() ?? "1970-01-01T00:00:00.000Z" });
  return { decision: validateGraphDescriptor(source, descriptor, "codegraph", options.reviewedToolSource), descriptor };
}
