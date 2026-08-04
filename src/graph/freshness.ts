import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import type { ProcessAdapter } from "../adapters/process.js";
import { GRAPH_FALLBACK_ACTION, type GraphCacheLock, type GraphDecision, type GraphDescriptor, type GraphRuntime, type GraphSource, type GraphState } from "./types.js";
import { graphPathContains, isGraphSha, validateGraphDescriptor as validateGraphDescriptorShape, validateGraphLock, validateGraphRuntime, validateGraphSource } from "./validation.js";

export function graphDecision(state: GraphState, reason: string): GraphDecision {
  return Object.freeze({ state, authoritative: state === "fresh", fallbackAction: GRAPH_FALLBACK_ACTION, reason });
}

/** Stable private identity: neither common directory nor branch name participates. */
export function graphCacheIdentity(adapter: GraphDescriptor["adapter"], reviewedToolSource: string, source: Pick<GraphSource, "worktreeRoot" | "worktreeInstanceId" | "headSha">, baselineSha?: string): string {
  const checked = validateGraphSource({ ...source, workingTreeFingerprint: `git-v1:${"0".repeat(64)}` });
  if (adapter !== "graphify" && adapter !== "codegraph" || typeof reviewedToolSource !== "string" || !isGraphSha(baselineSha ?? checked.headSha)) throw new Error("Invalid graph cache identity input.");
  return createHash("sha256").update(JSON.stringify([adapter, reviewedToolSource, checked.worktreeRoot, checked.worktreeInstanceId, (baselineSha ?? checked.headSha).toLowerCase()])).digest("hex");
}
/** Lock names live in a separate machine-local root, never in graph cache/output. */
export function graphLockPath(lockRoot: string, cacheIdentity: string): string {
  if (!isAbsolute(lockRoot) || resolve(lockRoot) !== lockRoot || !/^[0-9a-f]{64}$/.test(cacheIdentity)) throw new Error("Invalid graph lock path input.");
  return join(lockRoot, "graph-locks", `${cacheIdentity}.lock`);
}

export function validateGraphDescriptor(source: GraphSource, descriptor: GraphDescriptor | undefined, adapter: GraphDescriptor["adapter"], reviewedToolSource: string): GraphDecision {
  try { source = validateGraphSource(source); descriptor = descriptor === undefined ? undefined : validateGraphDescriptorShape(descriptor); } catch { return graphDecision("invalid", "Graph descriptor/source validation failed."); }
  if (!descriptor) return graphDecision("stale", "No graph descriptor exists for this source snapshot.");
  if (!isAbsolute(descriptor.worktreeRoot) || !isAbsolute(descriptor.cacheRoot) || descriptor.adapter !== adapter || descriptor.reviewedToolSource !== reviewedToolSource || resolve(descriptor.worktreeRoot) !== resolve(source.worktreeRoot) || descriptor.worktreeInstanceId !== source.worktreeInstanceId) return graphDecision("invalid", "Graph descriptor identity does not match the requested adapter/worktree.");
  if (descriptor.indexedCommit !== source.headSha || descriptor.workingTreeFingerprint !== source.workingTreeFingerprint) return graphDecision("stale", "Graph commit or working-tree fingerprint no longer matches source.");
  if (descriptor.cacheIdentity !== graphCacheIdentity(adapter, reviewedToolSource, source, descriptor.seededFromSha)) return graphDecision("invalid", "Graph cache identity is not private to this exact worktree and baseline.");
  if (adapter === "graphify" && (graphPathContains(source.worktreeRoot, descriptor.cacheRoot) || graphPathContains(descriptor.cacheRoot, source.worktreeRoot))) return graphDecision("invalid", "Graphify descriptor cache is not a private external root.");
  if (adapter === "codegraph" && descriptor.cacheRoot !== join(source.worktreeRoot, ".codegraph")) return graphDecision("invalid", "CodeGraph descriptor cache is not the canonical worktree .codegraph root.");
  return graphDecision("fresh", "Graph descriptor matches exact source snapshot.");
}

/** Validate a Git-authority-proved, clean main baseline before copying it. */
export function validateGraphBaseline(source: GraphSource, baseline: import("./types.js").GraphBaseline | undefined, adapter: GraphDescriptor["adapter"], reviewedToolSource: string): GraphDecision {
  try {
    source = validateGraphSource(source);
    if (!baseline || typeof baseline !== "object" || baseline.authoritativeRef !== "refs/heads/main" || baseline.clean !== true) throw new Error();
    const main = validateGraphSource(baseline.source);
    if (baseline.objectFormat !== "sha1" && baseline.objectFormat !== "sha256") throw new Error();
    const expectedLength = baseline.objectFormat === "sha1" ? 40 : 64;
    if (!isGraphSha(baseline.resolvedSha) || baseline.resolvedSha.length !== expectedLength || main.headSha !== baseline.resolvedSha.toLowerCase()) throw new Error();
    // A feature checkout may match main's content, but may never self-seed.
    if (resolve(main.worktreeRoot) === resolve(source.worktreeRoot) || main.worktreeInstanceId === source.worktreeInstanceId) throw new Error();
    const descriptor = validateGraphDescriptor(main, baseline.descriptor, adapter, reviewedToolSource);
    if (!descriptor.authoritative) return descriptor;
    if (main.headSha !== source.headSha || main.workingTreeFingerprint !== source.workingTreeFingerprint) return graphDecision("stale", "Authoritative-main baseline does not exactly match the feature source.");
    return graphDecision("fresh", "Clean authoritative-main baseline exactly matches the feature source.");
  } catch { return graphDecision("invalid", "Authoritative-main baseline proof is invalid."); }
}

/** Unknown, cross-host and malformed locks are deliberately blocked, never deleted automatically. */
export async function evaluateGraphLock(lock: GraphCacheLock | undefined, process: ProcessAdapter, maxAgeMs = 30 * 60_000): Promise<GraphDecision | undefined> {
  if (!lock) return undefined;
  try { lock = validateGraphLock(lock); } catch { return graphDecision("blocked", "Graph cache lock is malformed and requires manual verified recovery."); }
  const acquired = Date.parse(lock.acquiredAt);
  if (!Number.isFinite(acquired) || !lock.ownerHost || !Number.isInteger(lock.ownerPid) || lock.ownerPid < 1) return graphDecision("blocked", "Graph cache lock is malformed and requires manual verified recovery.");
  if (lock.ownerHost !== process.hostName()) return graphDecision("blocked", "Graph cache lock is owned by another host and requires manual verified recovery.");
  if (await process.isProcessAlive(lock.ownerPid)) return graphDecision("blocked", "Graph refresh is currently active.");
  if (process.now().getTime() - acquired < maxAgeMs) return graphDecision("blocked", "Graph lock owner cannot be verified stale yet.");
  return graphDecision("stale", "Dead local graph lock is stale; recover only through verified lock recovery.");
}

export async function evaluateGraphFreshness(input: { source: GraphSource; descriptor?: GraphDescriptor; adapter: GraphDescriptor["adapter"]; reviewedToolSource: string; runtime?: GraphRuntime; lock?: GraphCacheLock; process?: ProcessAdapter }): Promise<GraphDecision> {
  try { input.source = validateGraphSource(input.source); if (input.runtime) input.runtime = validateGraphRuntime(input.runtime); } catch { return graphDecision("invalid", "Graph source/runtime validation failed."); }
  if (input.runtime && !input.runtime.available) return graphDecision("unavailable", input.runtime.reason ?? "Experimental graph runtime is unavailable.");
  if (input.lock) { if (!input.process) return graphDecision("blocked", "Graph cache lock cannot be verified without process authority."); return (await evaluateGraphLock(input.lock, input.process))!; }
  return validateGraphDescriptor(input.source, input.descriptor, input.adapter, input.reviewedToolSource);
}
