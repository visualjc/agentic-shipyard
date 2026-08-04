import type { ProcessAdapter } from "../adapters/process.js";
import { randomUUID } from "node:crypto";
import { evaluateGraphLock, graphDecision } from "./freshness.js";
import type { GraphCacheLock, GraphDecision } from "./types.js";

/** Narrow injected persistence boundary; no lock is ever removed without verified local stale ownership. */
export interface GraphLockStore { read(path: string): Promise<GraphCacheLock | undefined>; createExclusive(path: string, lock: GraphCacheLock): Promise<boolean>; removeVerified(path: string, expected: GraphCacheLock): Promise<boolean>; }
export class GraphLockService {
  constructor(private readonly store: GraphLockStore, private readonly process: ProcessAdapter) {}
  async acquire(path: string): Promise<{ decision?: GraphDecision; lock?: GraphCacheLock }> {
    try {
      const present = await this.store.read(path);
      if (present) { const decision = await evaluateGraphLock(present, this.process); return { decision: decision ?? graphDecision("blocked", "Graph cache lock is present.") }; }
      const lock: GraphCacheLock = Object.freeze({ ownerHost: this.process.hostName(), ownerPid: this.process.processId(), acquiredAt: this.process.now().toISOString(), token: randomUUID() });
      return await this.store.createExclusive(path, lock) ? { lock } : { decision: graphDecision("blocked", "Graph cache lock was acquired by another process.") };
    } catch { return { decision: graphDecision("blocked", "Graph cache lock acquisition failed safely.") }; }
  }
  async release(path: string, lock: GraphCacheLock): Promise<void> {
    try { if (await this.store.removeVerified(path, lock)) return; } catch {}
    throw new Error("Graph lock release could not be verified.");
  }
  /** Explicit operator-only recovery; normal acquire never removes stale locks. */
  async recoverVerifiedStale(path: string): Promise<GraphDecision> {
    try {
      const present = await this.store.read(path);
      if (!present) return graphDecision("stale", "No graph lock is present.");
      const decision = await evaluateGraphLock(present, this.process);
      if (!decision || decision.state !== "stale") return graphDecision("blocked", "Graph lock is not verified stale for manual recovery.");
      return await this.store.removeVerified(path, present) ? graphDecision("stale", "Verified stale graph lock was recovered.") : graphDecision("blocked", "Verified stale graph lock changed before recovery.");
    } catch { return graphDecision("blocked", "Graph lock recovery failed safely."); }
  }
}
