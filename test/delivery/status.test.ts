import assert from "node:assert/strict";
import test from "node:test";
import { deliveryStatusContributor } from "../../src/delivery/status.js";
import { composeStatus, createStatusProjection } from "../../src/status/projection.js";

test("contributes delivery product and ledger pins through the shared status seam", () => {
  const base = createStatusProjection({ phase: "implementing", nextSafeAction: "shipyard-status" });
  const status = composeStatus(base, [deliveryStatusContributor({ productSha: "product-sha", ledgerSha: "ledger-sha", workspacePath: "/tmp/work", workspaceBranch: "shipyard/d-1" })]);
  assert.equal(status.productSha, "product-sha");
  assert.equal(status.ledgerSha, "ledger-sha");
  assert.equal(status.workspacePath, "/tmp/work");
  assert.equal(status.workspaceBranch, "shipyard/d-1");
  assert.deepEqual(status.blockers, []);
});

test("does not erase pins already supplied by another status contributor", () => {
  const base = createStatusProjection({ phase: "implementing", nextSafeAction: "shipyard-status", productSha: "existing-product", ledgerSha: "existing-ledger", workspacePath: "/existing/work", workspaceBranch: "shipyard/existing" });
  const status = composeStatus(base, [deliveryStatusContributor({}), () => ({ destinationSha: "destination" })]);
  assert.equal(status.productSha, "existing-product");
  assert.equal(status.ledgerSha, "existing-ledger");
  assert.equal(status.workspacePath, "/existing/work");
  assert.equal(status.workspaceBranch, "shipyard/existing");
  assert.equal(status.destinationSha, "destination");
});
