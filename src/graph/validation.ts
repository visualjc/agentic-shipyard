import { isAbsolute, relative, resolve } from "node:path";
import { GraphError } from "./errors.js";
import { GRAPH_FALLBACK_ACTION, GRAPH_STATES, type GraphCacheLock, type GraphDecision, type GraphDescriptor, type GraphRuntime, type GraphSource } from "./types.js";

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const FINGERPRINT = /^git-v1:[0-9a-f]{64}$/;
const RECEIPT = /^(?:graphify@0\.9\.32#00efd6e7969837ae4a9f11d8d504dcd3b20b09df|codegraph@1\.5\.0#49c11fc2e0c02170742be8411e66a31af611f4b7)$/;

/** Never read a hostile getter or Proxy value; callers receive a fixed safe diagnostic. */
function plain(value: unknown, name: string): Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) if (!("value" in descriptor)) throw new Error();
    return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
  } catch { throw new GraphError("invalid-descriptor", `Invalid ${name} graph value.`); }
}
function only(v: Record<string, unknown>, allowed: readonly string[], name: string): void { if (Object.keys(v).some((key) => !allowed.includes(key))) throw new GraphError("invalid-descriptor", `Invalid ${name} graph value.`); }
function string(value: unknown, name: string): string { if (typeof value !== "string") throw new GraphError("invalid-descriptor", `Invalid ${name} graph value.`); return value; }
function root(value: unknown, name: string): string { const result = string(value, name); if (!isAbsolute(result) || result !== resolve(result)) throw new GraphError("unsafe-path", `Invalid ${name} graph path.`); return result; }
function sha(value: unknown, name: string): string { const result = string(value, name); if (!SHA.test(result)) throw new GraphError("invalid-descriptor", `Invalid ${name} graph SHA.`); return result.toLowerCase(); }

export function isGraphSha(value: unknown): value is string { return typeof value === "string" && SHA.test(value); }
export function graphPathContains(parent: string, child: string): boolean { const part = relative(parent, child); return part === "" || (!part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && part !== ".." && !isAbsolute(part)); }
export function validateGraphSource(value: unknown): GraphSource {
  const v = plain(value, "source"); only(v, ["worktreeRoot", "worktreeInstanceId", "headSha", "workingTreeFingerprint"], "source"); const worktreeRoot = root(v.worktreeRoot, "source"); const worktreeInstanceId = string(v.worktreeInstanceId, "source"); if (!/^git-worktree-v1:[0-9a-f]{64}$/.test(worktreeInstanceId)) throw new GraphError("invalid-descriptor", "Invalid source worktree instance."); const headSha = sha(v.headSha, "source"); const workingTreeFingerprint = string(v.workingTreeFingerprint, "source");
  if (!FINGERPRINT.test(workingTreeFingerprint)) throw new GraphError("invalid-descriptor", "Invalid source graph fingerprint.");
  return Object.freeze({ worktreeRoot, worktreeInstanceId, headSha, workingTreeFingerprint });
}
export function validateGraphDescriptor(value: unknown): GraphDescriptor {
  const v = plain(value, "descriptor"); only(v, ["adapter", "reviewedToolSource", "cacheIdentity", "cacheRoot", "worktreeRoot", "worktreeInstanceId", "indexedCommit", "workingTreeFingerprint", "refreshedAt", "seededFromSha"], "descriptor"); const adapter = string(v.adapter, "descriptor");
  const receipt = string(v.reviewedToolSource, "descriptor");
  if ((adapter !== "graphify" && adapter !== "codegraph") || !RECEIPT.test(receipt) || (adapter === "graphify" ? !receipt.startsWith("graphify@") : !receipt.startsWith("codegraph@"))) throw new GraphError("invalid-descriptor", "Invalid graph adapter receipt.");
  const cacheIdentity = string(v.cacheIdentity, "descriptor"); if (!/^[0-9a-f]{64}$/.test(cacheIdentity)) throw new GraphError("invalid-descriptor", "Invalid graph cache identity.");
  const refreshedAt = string(v.refreshedAt, "descriptor"); if (!Number.isFinite(Date.parse(refreshedAt))) throw new GraphError("invalid-descriptor", "Invalid graph refresh timestamp.");
  const seededFromSha = v.seededFromSha === undefined ? undefined : sha(v.seededFromSha, "seed");
  const workingTreeFingerprint = string(v.workingTreeFingerprint, "descriptor"); if (!FINGERPRINT.test(workingTreeFingerprint)) throw new GraphError("invalid-descriptor", "Invalid descriptor graph fingerprint.");
  const worktreeInstanceId = string(v.worktreeInstanceId, "descriptor"); if (!/^git-worktree-v1:[0-9a-f]{64}$/.test(worktreeInstanceId)) throw new GraphError("invalid-descriptor", "Invalid descriptor worktree instance.");
  return Object.freeze({ adapter, reviewedToolSource: receipt, cacheIdentity, cacheRoot: root(v.cacheRoot, "cache"), worktreeRoot: root(v.worktreeRoot, "worktree"), worktreeInstanceId, indexedCommit: sha(v.indexedCommit, "descriptor"), workingTreeFingerprint, refreshedAt, ...(seededFromSha ? { seededFromSha } : {}) } as GraphDescriptor);
}
export function validateGraphRuntime(value: unknown): GraphRuntime { const v = plain(value, "runtime"); only(v, ["available", "reason"], "runtime"); if (typeof v.available !== "boolean" || (v.reason !== undefined && typeof v.reason !== "string")) throw new GraphError("invalid-descriptor", "Invalid graph runtime."); return Object.freeze({ available: v.available, ...(typeof v.reason === "string" ? { reason: v.reason } : {}) }); }
export function validateGraphLock(value: unknown): GraphCacheLock { const v = plain(value, "lock"); only(v, ["ownerHost", "ownerPid", "acquiredAt", "token"], "lock"); const ownerPid = v.ownerPid; if (typeof v.ownerHost !== "string" || typeof ownerPid !== "number" || !Number.isSafeInteger(ownerPid) || ownerPid < 1 || typeof v.acquiredAt !== "string" || !Number.isFinite(Date.parse(v.acquiredAt)) || (v.token !== undefined && (typeof v.token !== "string" || !/^[0-9a-f-]{36}$/.test(v.token)))) throw new GraphError("invalid-descriptor", "Invalid graph lock."); return Object.freeze({ ownerHost: v.ownerHost, ownerPid, acquiredAt: v.acquiredAt, ...(typeof v.token === "string" ? { token: v.token } : {}) }); }
export function validateGraphDecision(value: unknown): GraphDecision { const v = plain(value, "decision"); only(v, ["state", "authoritative", "fallbackAction", "reason"], "decision"); if (typeof v.state !== "string" || !GRAPH_STATES.includes(v.state as never) || v.authoritative !== (v.state === "fresh") || v.fallbackAction !== GRAPH_FALLBACK_ACTION || typeof v.reason !== "string" || Buffer.byteLength(v.reason) > 1024) throw new GraphError("invalid-descriptor", "Invalid graph decision."); return Object.freeze({ state: v.state as GraphDecision["state"], authoritative: v.authoritative, fallbackAction: GRAPH_FALLBACK_ACTION, reason: v.reason }); }
