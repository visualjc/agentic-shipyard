import type { DeliveryPhase } from "../contracts/types.js";
import type { GraphDecision, GraphState } from "../graph/types.js";

export type StatusBlocker = { code: string; message: string };
export type SyncFreshness = "fresh" | "stale" | "unavailable";
export type StatusProjection = Readonly<{
  phase: DeliveryPhase;
  productSha?: string;
  ledgerSha?: string;
  workspacePath?: string;
  workspaceBranch?: string;
  destinationSha?: string;
  acceptanceFresh?: boolean;
  providerRefs?: Readonly<Record<string, string>>;
  locks?: Readonly<Record<string, "free" | "held" | "stale">>;
  syncFreshness?: SyncFreshness;
  graphFreshness?: GraphState;
  graph?: Readonly<{ enabled: boolean; adapter?: string; receipt?: string; state: GraphState; reason: string; nextAction: "inspect-source-directly" }>;
  /** FR-018 detached orchestration handoff.  These contain display-only IDs
   * and receipts, never a filesystem path, credential, adapter, or operation. */
  planning?: Readonly<{
    recordId: string;
    lane: "large" | "small" | "bug" | "review-only";
    phase: string;
    resumeCheckpoint?: string;
    provider?: "codex";
  }>;
  dependencies?: readonly Readonly<{ dependency: string; state: string; remediation: string }>[];
  blockers: readonly StatusBlocker[];
  nextSafeAction: string;
}>;

/** A later slice contributes a partial projection without reimplementing status policy. */
export type StatusContributor = (projection: StatusProjection) => Partial<Omit<StatusProjection, "blockers">> & { blockers?: readonly StatusBlocker[] };

export function createStatusProjection(input: Pick<StatusProjection, "phase" | "nextSafeAction"> & Partial<Omit<StatusProjection, "phase" | "nextSafeAction" | "blockers">>): StatusProjection {
  return Object.freeze({ ...input, ...(input.dependencies ? { dependencies: Object.freeze(input.dependencies.map((item) => Object.freeze({ ...item }))) } : {}), blockers: Object.freeze([]) });
}

export function composeStatus(base: StatusProjection, contributors: readonly StatusContributor[]): StatusProjection {
  return contributors.reduce<StatusProjection>((current, contribute) => {
    const next = contribute(current);
    const requestedAction = typeof next.nextSafeAction === "string" && next.nextSafeAction ? next.nextSafeAction : undefined;
    // The first blocker establishes action precedence; later contributors may
    // add evidence without erasing the action needed to resolve that blocker.
    const nextSafeAction = current.blockers.length > 0 || !requestedAction ? current.nextSafeAction : requestedAction;
    return Object.freeze({ ...current, ...next, blockers: Object.freeze([...current.blockers, ...(next.blockers ?? [])]), nextSafeAction });
  }, base);
}
