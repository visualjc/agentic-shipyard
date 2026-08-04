import type { DeliveryPhase } from "../contracts/types.js";

export type StatusBlocker = { code: string; message: string };
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
  graphFreshness?: "fresh" | "stale" | "unavailable";
  blockers: readonly StatusBlocker[];
  nextSafeAction: string;
}>;

/** A later slice contributes a partial projection without reimplementing status policy. */
export type StatusContributor = (projection: StatusProjection) => Partial<Omit<StatusProjection, "blockers">> & { blockers?: readonly StatusBlocker[] };

export function createStatusProjection(input: Pick<StatusProjection, "phase" | "nextSafeAction"> & Partial<Omit<StatusProjection, "phase" | "nextSafeAction" | "blockers">>): StatusProjection {
  return Object.freeze({ ...input, blockers: Object.freeze([]) });
}

export function composeStatus(base: StatusProjection, contributors: readonly StatusContributor[]): StatusProjection {
  return contributors.reduce<StatusProjection>((current, contribute) => {
    const next = contribute(current);
    return Object.freeze({ ...current, ...next, blockers: Object.freeze([...current.blockers, ...(next.blockers ?? [])]) });
  }, base);
}
