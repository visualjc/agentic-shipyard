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
  let snapshot: Record<string, unknown>; try { const d = Object.getOwnPropertyDescriptors(source); if (Object.values(d).some(field => !("value" in field))) throw new Error(); snapshot = Object.fromEntries(Object.entries(d).map(([key, field]) => [key, field.value])); } catch { throw new Error("Invalid graph cache identity input."); }
  const checked = validateGraphSource({ worktreeRoot: snapshot.worktreeRoot, worktreeInstanceId: snapshot.worktreeInstanceId, headSha: snapshot.headSha, workingTreeFingerprint: `git-v1:${"0".repeat(64)}` });
  if (adapter !== "graphify" && adapter !== "codegraph" || typeof reviewedToolSource !== "string" || !isGraphSha(baselineSha ?? checked.headSha)) throw new Error("Invalid graph cache identity input.");
  return createHash("sha256").update(JSON.stringify([adapter, reviewedToolSource, checked.worktreeRoot, checked.worktreeInstanceId, (baselineSha ?? checked.headSha).toLowerCase()])).digest("hex");
}
/** Stable mutation identity: every source snapshot for one physical cache shares one lock. */
export function graphOperationLockIdentity(adapter: GraphDescriptor["adapter"], reviewedToolSource: string, source: Pick<GraphSource, "worktreeRoot" | "worktreeInstanceId">): string {
  let root: unknown, instance: unknown;
  try { const d = Object.getOwnPropertyDescriptors(source); if (Object.values(d).some(field => !("value" in field))) throw new Error(); root = d.worktreeRoot?.value; instance = d.worktreeInstanceId?.value; } catch { throw new Error("Invalid graph lock identity input."); }
  if ((adapter !== "graphify" && adapter !== "codegraph") || typeof reviewedToolSource !== "string" || typeof root !== "string" || !isAbsolute(root) || resolve(root) !== root || typeof instance !== "string" || !/^git-worktree-v1:[0-9a-f]{64}$/.test(instance)) throw new Error("Invalid graph lock identity input.");
  return createHash("sha256").update(JSON.stringify([adapter, reviewedToolSource, root, instance])).digest("hex");
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

/** Unknown, cross-host and malformed locks are deliberately blocked, never deleted automatically. */
export async function evaluateGraphLock(lock: GraphCacheLock | undefined, process: ProcessAdapter, maxAgeMs = 30 * 60_000): Promise<GraphDecision | undefined> {
  if (!lock) return undefined;
  try { lock = validateGraphLock(lock); } catch { return graphDecision("blocked", "Graph cache lock is malformed and requires manual verified recovery."); }
  const acquired = Date.parse(lock.acquiredAt);
  if (!Number.isFinite(acquired) || !lock.ownerHost || !Number.isInteger(lock.ownerPid) || lock.ownerPid < 1) return graphDecision("blocked", "Graph cache lock is malformed and requires manual verified recovery.");
  let host: string;
  try { host = (method(process, "hostName") as ProcessAdapter["hostName"])(); } catch { return graphDecision("blocked", "Graph lock ownership could not be observed safely."); }
  if (lock.ownerHost !== host) return graphDecision("blocked", "Graph cache lock is owned by another host and requires manual verified recovery.");
  let alive: boolean, now: number;
  try { alive = await (method(process, "isProcessAlive") as ProcessAdapter["isProcessAlive"])(lock.ownerPid); now = (method(process, "now") as ProcessAdapter["now"])().getTime(); } catch { return graphDecision("blocked", "Graph lock ownership could not be observed safely."); }
  if (alive) return graphDecision("blocked", "Graph refresh is currently active.");
  if (now - acquired < maxAgeMs) return graphDecision("blocked", "Graph lock owner cannot be verified stale yet.");
  return graphDecision("stale", "Dead local graph lock is stale; recover only through verified lock recovery.");
}

export async function evaluateGraphFreshness(input: { source: GraphSource; descriptor?: GraphDescriptor; adapter: GraphDescriptor["adapter"]; reviewedToolSource: string; runtime?: GraphRuntime; lock?: GraphCacheLock; process?: ProcessAdapter }): Promise<GraphDecision> {
  let value: Record<string, unknown>, source: GraphSource, runtime: GraphRuntime | undefined;
  try { const d = Object.getOwnPropertyDescriptors(input); if (Object.values(d).some(field => !("value" in field))) throw new Error(); value = Object.fromEntries(Object.entries(d).map(([key, field]) => [key, field.value])); source = validateGraphSource(value.source); runtime = value.runtime === undefined ? undefined : validateGraphRuntime(value.runtime); } catch { return graphDecision("invalid", "Graph source/runtime validation failed."); }
  if (runtime && !runtime.available) return graphDecision("unavailable", "Experimental graph runtime is unavailable.");
  if (value.lock) { if (!value.process) return graphDecision("blocked", "Graph cache lock cannot be verified without process authority."); return (await evaluateGraphLock(value.lock as GraphCacheLock, value.process as ProcessAdapter))!; }
  return validateGraphDescriptor(source, value.descriptor as GraphDescriptor | undefined, value.adapter as GraphDescriptor["adapter"], value.reviewedToolSource as string);
}

function method(value: object, name: string): Function { const own = Object.getOwnPropertyDescriptor(value, name); const prototype = Object.getPrototypeOf(value); const inherited = prototype && Object.getOwnPropertyDescriptor(prototype, name); const descriptor = own ?? inherited; if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") throw new Error(); return descriptor.value.bind(value); }
