/** Pure, detached planning data.  These values deliberately carry no adapter or authority. */
import type { DependencyState } from "../dependencies/types.js";
export type Lane = "large" | "small" | "bug" | "review-only";
export type ClassificationDisposition = "ready" | "needs-grilling" | "needs-wayfinding";
export type NextSafeAction = "wayfinder" | "grill-with-docs" | "diagnosing-bugs" | "grilling" | "scoped-review";

export type LaneReason = Readonly<{ code: string; evidence: string }>;
export type LaneDecision = Readonly<{
  schemaVersion: 1;
  lane: Lane;
  disposition: ClassificationDisposition;
  reasons: readonly LaneReason[];
  planningSequence: readonly string[];
  nextSafeAction: NextSafeAction;
}>;

/** Persistable state only; IDs are opaque and no source path or provider handle is retained. */
export type LaneRecord = Readonly<{
  schemaVersion: 1;
  recordId: string;
  decision: LaneDecision;
  phase: "classified" | "awaiting-clarification" | "planned";
  dependencyStates: readonly Readonly<{ dependency: string; state: DependencyState }>[];
  blockers: readonly Readonly<{ code: string; message: string }>[];
  nextSafeAction: NextSafeAction;
}>;
