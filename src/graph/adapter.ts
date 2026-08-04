import type { GraphAdapter, GraphDecision, GraphDescriptor, GraphResult, GraphSource } from "./types.js";
import { graphDecision } from "./freshness.js";
import { evaluateGraphLock } from "./freshness.js";
import { snapshotGraphSource, type GraphSourceReader } from "./fingerprint.js";
import type { ProcessAdapter } from "../adapters/process.js";
import type { GraphCacheLock } from "./types.js";
import { validateGraphRuntime } from "./validation.js";

/** Executes only injected local adapters; source is captured before and after refresh. */
export async function refreshGraph(adapter: GraphAdapter, reader: GraphSourceReader, worktree: string, existing?: GraphDescriptor, lock?: GraphCacheLock, process?: ProcessAdapter): Promise<GraphResult> {
  let before: GraphSource;
  try { before = await snapshotGraphSource(reader, worktree); }
  catch { return { decision: graphDecision("unavailable", "Source snapshot unavailable.") }; }
  // Existing descriptors are intentionally never reused across a refresh; each run
  // must publish only a descriptor proved against the post-refresh snapshot.
  void existing;
  if (lock) {
    if (!process) return { decision: graphDecision("blocked", "Graph cache lock cannot be verified without process authority.") };
    const lockDecision = await evaluateGraphLock(lock, process);
    if (lockDecision) return { decision: lockDecision };
  }
  let runtime;
  try { runtime = validateGraphRuntime(await adapter.probe()); }
  catch { return { decision: graphDecision("unavailable", "Experimental graph runtime probe failed.") }; }
  if (!runtime.available) return { decision: graphDecision("unavailable", runtime.reason ?? "Graph runtime unavailable.") };
  try {
    const descriptor = await adapter.refresh(before);
    const after = await snapshotGraphSource(reader, worktree);
    if (after.headSha !== before.headSha || after.workingTreeFingerprint !== before.workingTreeFingerprint) return { decision: graphDecision("stale", "Source changed while graph refresh was running.") };
    let decision;
    try {
      decision = await adapter.status(after, descriptor);
      if (!decision || typeof decision !== "object" || decision.authoritative !== (decision.state === "fresh") || decision.fallbackAction !== "inspect-source-directly" || typeof decision.reason !== "string") throw new Error();
    }
    catch { return { decision: graphDecision("failed", "Experimental graph status verification failed.") }; }
    return decision.authoritative ? { decision, descriptor } : { decision };
  } catch {
    return { decision: graphDecision("failed", "Graph refresh failed.") };
  }
}
