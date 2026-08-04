import type { StatusContributor } from "../status/projection.js";
import type { SourceProvenance } from "./types.js";

export type SyncStatus = Readonly<{ baseline: "fresh" | "stale" | "unavailable"; source?: Readonly<{ provenance: SourceProvenance; fresh: boolean }>; blocker?: Readonly<{ code: string; message: string; nextSafeAction: string }> }>;

/** Pure projection contribution: callers provide local facts; this function performs no I/O. */
export function syncStatusContributor(status: SyncStatus): StatusContributor {
  return () => ({
    graphFreshness: status.baseline === "fresh" && (status.source?.fresh ?? true) ? "fresh" : status.baseline === "unavailable" ? "unavailable" : "stale",
    providerRefs: status.source ? { sourceRef: status.source.provenance.requestedRef, sourceSha: status.source.provenance.sha } : undefined,
    blockers: status.blocker ? [{ code: status.blocker.code, message: status.blocker.message }] : [],
    nextSafeAction: status.blocker?.nextSafeAction,
  });
}
