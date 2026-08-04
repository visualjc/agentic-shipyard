import assert from "node:assert/strict";
import test from "node:test";
import { composeStatus, createStatusProjection, type StatusProjection } from "../../src/index.js";

test("status contributors add fields and blockers without replacing earlier blockers", () => {
  const base = createStatusProjection({ phase: "awaiting-review", nextSafeAction: "shipyard-review", productSha: "abc" });
  const projection = composeStatus(base, [
    () => ({ blockers: [{ code: "evidence-stale", message: "Evidence must name abc." }], acceptanceFresh: false }),
    () => ({ providerRefs: { developmentPr: "https://example.test/pr/1" }, blockers: [{ code: "review-needed", message: "Independent review is required." }] }),
  ]);
  assert.equal(projection.productSha, "abc");
  assert.equal(projection.acceptanceFresh, false);
  assert.deepEqual(projection.blockers.map((blocker) => blocker.code), ["evidence-stale", "review-needed"]);
  assert.equal(projection.providerRefs?.developmentPr, "https://example.test/pr/1");
});

test("contributors consume the projection contract rather than implementation state", () => {
  const base: StatusProjection = createStatusProjection({ phase: "ready", nextSafeAction: "shipyard" });
  const result = composeStatus(base, [(current) => current.phase === "ready" ? { graphFreshness: "unavailable" } : {}]);
  assert.equal(result.graphFreshness, "unavailable");
  assert.equal(Object.isFrozen(result), true);
});
