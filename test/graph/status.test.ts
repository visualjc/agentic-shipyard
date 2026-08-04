import assert from "node:assert/strict";
import test from "node:test";
import { composeStatus, createStatusProjection, graphDecision, graphStatusContributor } from "../../src/index.js";
test("graph status is read-only data and conservative states choose direct inspection", () => {
  for (const state of ["disabled", "stale", "unavailable", "invalid", "blocked", "failed"] as const) {
    const projection = composeStatus(createStatusProjection({ phase: "ready", nextSafeAction: "shipyard" }), [graphStatusContributor({ enabled: state !== "disabled", adapter: "graphify", receipt: "pin", decision: graphDecision(state, state) })]);
    assert.equal(projection.graph?.state, state); assert.equal(projection.nextSafeAction, "inspect-source-directly");
  }
});
test("graph fallback never erases an existing restrictive action or blocker", () => {
  const projection = composeStatus(createStatusProjection({ phase: "ready", nextSafeAction: "repair-proof" }), [() => ({ blockers: [{ code: "proof", message: "repair" }] }), graphStatusContributor({ enabled: true, decision: graphDecision("stale", "stale") })]);
  assert.equal(projection.nextSafeAction, "repair-proof"); assert.equal(projection.blockers.length, 1);
});
