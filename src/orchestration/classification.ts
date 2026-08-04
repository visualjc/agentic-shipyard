import { OrchestrationError } from "./errors.js";
import type { LaneDecision, LaneRecord, NextSafeAction } from "./types.js";
import type { DependencyState } from "../dependencies/types.js";

type Plain = Record<string, unknown>;
const fail = (): never => { throw new OrchestrationError("invalid-classification", "Lane input must be a bounded, plain data document."); };
const text = (value: unknown, max = 512): string => { if (typeof value !== "string" || value.trim() === "" || value !== value.trim() || value.includes("\0") || value.length > max) fail(); return value as string; };
const data = (value: PropertyDescriptor | undefined): value is PropertyDescriptor & { value: unknown } => Boolean(value && "value" in value);
function snapshot(value: unknown, seen = new Set<object>(), depth = 0): unknown {
  try {
    if (depth > 8) fail();
    if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
    if (!value || typeof value !== "object" || seen.has(value)) fail();
    const object = value as object; seen.add(object);
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(object) as Record<string, PropertyDescriptor>, length = descriptors["length"];
      if (!data(length) || !Number.isSafeInteger(length.value) || typeof length.value !== "number" || length.value > 64 || Reflect.ownKeys(object).some(key => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key)))) fail();
      const output: unknown[] = [];
      for (let index = 0; index < length.value; index++) { const item = descriptors[String(index)]; if (!data(item) || !item.enumerable) fail(); output.push(snapshot(item.value, seen, depth + 1)); }
      seen.delete(object); return output;
    }
    if (Object.getPrototypeOf(object) !== Object.prototype) fail();
    const output: Plain = {};
    for (const rawKey of Reflect.ownKeys(object)) { if (typeof rawKey !== "string") fail(); const key = rawKey as string, descriptor = Object.getOwnPropertyDescriptor(object, key); if (!data(descriptor) || !descriptor.enumerable) fail(); output[key] = snapshot((descriptor as { value: unknown }).value, seen, depth + 1); }
    seen.delete(object); return output;
  } catch { fail(); }
}
function exact(value: unknown, keys: readonly string[], optional: readonly string[] = []): Plain { const plain = snapshot(value); if (!plain || typeof plain !== "object" || Array.isArray(plain)) fail(); const record = plain as Plain; if (Object.keys(record).some(key => !keys.includes(key)) || keys.some(key => !optional.includes(key) && !(key in record))) fail(); return record; }
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) freeze(child); Object.freeze(value); } return value; }
function decision(lane: LaneDecision["lane"], disposition: LaneDecision["disposition"], reasons: readonly Readonly<{ code: string; evidence: string }>[]): LaneDecision {
  const action: NextSafeAction = disposition === "needs-wayfinding" ? "wayfinder" : disposition === "needs-grilling" ? "grilling" : lane === "large" ? "wayfinder" : lane === "small" ? "grill-with-docs" : lane === "bug" ? "diagnosing-bugs" : "scoped-review";
  const planningSequence = disposition === "needs-wayfinding" ? ["wayfinder"] : disposition === "needs-grilling" ? ["grilling"] : lane === "large" ? ["wayfinder", "ccpm-prd", "ccpm-vertical-tasks"] : lane === "small" ? ["grill-with-docs", "to-spec"] : lane === "bug" ? ["diagnosing-bugs"] : ["scoped-review"];
  return freeze({ schemaVersion: 1, lane, disposition, reasons, planningSequence, nextSafeAction: action });
}
/** Classifies only recorded signals. A bug diagnosis is a planning step, never delivery authority. */
export function classifyLane(input: unknown): LaneDecision {
  const root = exact(input, ["kind", "scope", "requirements", "regression", "requestedHead", "reasons"], ["regression", "requestedHead"]);
  const kind = text(root.kind), scope = text(root.scope), requirements = text(root.requirements);
  if (!["feature", "bug", "review"].includes(kind) || !["settled", "foggy", "unknown"].includes(scope) || !["compatible", "conflicting", "unknown"].includes(requirements) || !Array.isArray(root.reasons) || root.reasons.length === 0 || root.reasons.length > 16) fail();
  const reasons = (root.reasons as unknown[]).map((value: unknown) => { const row = exact(value, ["code", "evidence"]); return freeze({ code: text(row.code, 128), evidence: text(row.evidence, 1024) }); });
  if (kind === "review") { if (scope !== "settled" || typeof root.requestedHead !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(root.requestedHead)) fail(); return decision("review-only", "ready", reasons); }
  if (kind === "bug") {
    if (root.regression !== undefined && !["proven", "unproven", "unknown"].includes(text(root.regression))) fail();
    return decision("bug", requirements === "conflicting" ? "needs-grilling" : requirements === "unknown" ? "needs-wayfinding" : "ready", reasons);
  }
  return decision(scope === "settled" && requirements === "compatible" ? "small" : "large", scope === "unknown" ? "needs-wayfinding" : requirements !== "compatible" ? "needs-grilling" : "ready", reasons);
}
export function createLaneRecord(input: unknown): LaneRecord {
  const root = exact(input, ["recordId", "decision", "dependencyStates", "blockers"], ["blockers"]), recordId = text(root.recordId, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(recordId) || !Array.isArray(root.dependencyStates) || root.dependencyStates.length > 32 || (root.blockers !== undefined && (!Array.isArray(root.blockers) || root.blockers.length > 32))) fail();
  const rawDecision = exact(root.decision, ["schemaVersion", "lane", "disposition", "reasons", "planningSequence", "nextSafeAction"]);
  if (rawDecision.schemaVersion !== 1 || typeof rawDecision.lane !== "string" || typeof rawDecision.disposition !== "string" || !["large", "small", "bug", "review-only"].includes(rawDecision.lane) || !["ready", "needs-grilling", "needs-wayfinding"].includes(rawDecision.disposition) || !Array.isArray(rawDecision.reasons) || rawDecision.reasons.length > 16) fail();
  const verifiedReasons = (rawDecision.reasons as unknown[]).map((value: unknown) => { const item = exact(value, ["code", "evidence"]); return freeze({ code: text(item.code, 128), evidence: text(item.evidence, 1024) }); });
  const accepted = decision(rawDecision.lane as LaneDecision["lane"], rawDecision.disposition as LaneDecision["disposition"], verifiedReasons);
  if (JSON.stringify(accepted.planningSequence) !== JSON.stringify(rawDecision.planningSequence) || accepted.nextSafeAction !== rawDecision.nextSafeAction) fail();
  const dependencyNames = new Set<string>(), dependencyStates = (root.dependencyStates as unknown[]).map((value: unknown) => { const row = exact(value, ["dependency", "state"]), dependency = text(row.dependency, 128), state = text(row.state, 64); if (dependencyNames.has(dependency) || !["ready", "missing", "modified", "duplicate", "incompatible", "unverified", "not-required"].includes(state)) fail(); dependencyNames.add(dependency); return freeze({ dependency, state: state as DependencyState }); });
  const blockers = ((root.blockers ?? []) as unknown[]).map((value: unknown) => { const row = exact(value, ["code", "message"]); return freeze({ code: text(row.code, 128), message: text(row.message, 1024) }); });
  return freeze({ schemaVersion: 1, recordId, decision: accepted, phase: accepted.disposition === "ready" ? "classified" : "awaiting-clarification", dependencyStates, blockers, nextSafeAction: accepted.nextSafeAction });
}
