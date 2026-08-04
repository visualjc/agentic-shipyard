import type { LaneRecord } from "./types.js";
import type { PlanningCheckpoint, ProviderCheckpoint, ReviewIntent } from "./ledger.js";
type PlanningStatusBase = Readonly<{ recordId: string; productSha: string; ledgerSha?: string; blockers: readonly Readonly<{ code: string; message: string }>[]; nextSafeCommand: string }>;
type ClassifiedPlanningStatus = PlanningStatusBase & Readonly<{ lane: LaneRecord["decision"]["lane"]; phase: LaneRecord["phase"] | "diagnosed" | "review-intent-recorded"; provider?: Readonly<{ id: "codex"; status: "complete" }>; reviewTarget?: ReviewIntent["target"] }>;
type DependencyBlockedPlanningStatus = PlanningStatusBase & Readonly<{ lane: "unclassified"; phase: "dependency-blocked"; provider?: never; reviewTarget?: never }>;
/** A detached result can be classified and persisted, or explicitly stopped before either happens. */
export type PlanningStatus = ClassifiedPlanningStatus | DependencyBlockedPlanningStatus;
/** Only detached display data crosses this boundary. */
export function planningStatus(checkpoint: PlanningCheckpoint, provider?: ProviderCheckpoint, review?: ReviewIntent, currentLedgerSha = checkpoint.pin.historicalBaseLedgerSha): PlanningStatus { const record = checkpoint.record; const phase = review ? "review-intent-recorded" : provider?.phase === "diagnosed" ? "diagnosed" : provider?.phase === "planned" ? "planned" : record.phase;
  // Route-only compositions persist classification but never manufacture a
  // provider result. The focused skill is the executable next action.
  const command = review ? `shipyard-review --delivery-id ${record.recordId}` : phase === "classified" || phase === "awaiting-clarification" ? `$${record.nextSafeAction}` : `shipyard resume ${record.recordId}`;
  return freeze({ recordId: record.recordId, lane: record.decision.lane, phase, productSha: checkpoint.pin.productSha, ledgerSha: currentLedgerSha, blockers: record.blockers.map((blocker: Readonly<{ code: string; message: string }>) => ({ ...blocker })), nextSafeCommand: command, ...(provider ? { provider: { id: "codex" as const, status: "complete" as const } } : {}), ...(review ? { reviewTarget: { ...review.target } } : {}) }); }
/** A dependency gate runs before classification and deliberately creates no ledger record. */
export function dependencyBlockedPlanningStatus(input: Readonly<{ recordId: string; productSha: string; ledgerSha?: string; blockers: readonly Readonly<{ code: string; message: string }>[]; nextSafeCommand: string }>): PlanningStatus { return freeze({ recordId: input.recordId, lane: "unclassified" as const, phase: "dependency-blocked" as const, productSha: input.productSha, ...(input.ledgerSha ? { ledgerSha: input.ledgerSha } : {}), blockers: input.blockers.map(blocker => ({ ...blocker })), nextSafeCommand: input.nextSafeCommand }); }
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) freeze(child); Object.freeze(value); } return value; }
