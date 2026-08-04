import assert from "node:assert/strict";
import test from "node:test";
import { LedgerError } from "../../src/ledger/errors.js";
import {
  createFinalLedgerSeal,
  finalSealManifest,
  finalSealPath,
  validateFinalLedgerSeal,
  verifyFinalLedgerSeal,
} from "../../src/ledger/final-seal.js";

const productSha = "a".repeat(40);
const preSealLedgerSha = "b".repeat(40);
const sealCommitSha = "c".repeat(40);
const deliveryId = "delivery-001";
const records = {
  "deliveries/delivery-001/review.json": "bravo\n",
  "deliveries/delivery-001/acceptance.json": "alpha",
};

function canonicalSeal(): string {
  return createFinalLedgerSeal({ deliveryId, productSha, preSealLedgerSha, records });
}

function verification(overrides: Record<string, unknown> = {}) {
  return {
    externalSealCommitSha: sealCommitSha,
    observedCommit: {
      commitSha: sealCommitSha,
      parentSha: preSealLedgerSha,
      changes: [{ status: "added" as const, path: finalSealPath(deliveryId) }],
    },
    currentProductSha: productSha,
    sealContents: canonicalSeal(),
    records,
    ...overrides,
  };
}

test("creates canonical versioned bytes with a sorted durable path-and-byte-hash manifest", () => {
  assert.deepEqual(finalSealManifest(deliveryId, records), [
    { path: "deliveries/delivery-001/acceptance.json", sha256: "8ed3f6ad685b959ead7022518e1af76cd816f8e8ec7ccdda1ed4018e8f2223f8" },
    { path: "deliveries/delivery-001/review.json", sha256: "5da8f23decf397b13f4f55b6fb8a61936238bfe08ed9d901132974f1beccc45c" },
  ]);
  assert.equal(canonicalSeal(), JSON.stringify({
    schemaVersion: 1,
    deliveryId,
    productSha,
    preSealLedgerSha,
    manifest: finalSealManifest(deliveryId, records),
  }));
  assert.deepEqual(validateFinalLedgerSeal(canonicalSeal()), JSON.parse(canonicalSeal()));
});

test("strict validation rejects noncanonical, extra, malformed, duplicate, unsafe, and self-referential data", () => {
  const parsed = JSON.parse(canonicalSeal()) as Record<string, unknown>;
  const manifest = parsed.manifest as unknown[];
  for (const invalid of [
    `${canonicalSeal()}\n`,
    JSON.stringify({ ...parsed, extra: true }),
    JSON.stringify({ ...parsed, manifest: [manifest[1], manifest[0]] }),
    JSON.stringify({ ...parsed, manifest: [manifest[0], manifest[0]] }),
    JSON.stringify({ ...parsed, manifest: [{ path: "../escape", sha256: "0".repeat(64) }] }),
    JSON.stringify({ ...parsed, manifest: [{ path: finalSealPath(deliveryId), sha256: "0".repeat(64) }] }),
    JSON.stringify({ ...parsed, manifest: [{ ...(manifest[0] as object), extra: true }] }),
  ]) assert.throws(() => validateFinalLedgerSeal(invalid), (error: unknown) => error instanceof LedgerError && error.code === "ledger-invalid-record");
});

test("pure verification binds the external commit, its sole added seal, parent, current product, and exact record bytes", () => {
  assert.deepEqual(verifyFinalLedgerSeal(verification()), JSON.parse(canonicalSeal()));
  const cases = [
    verification({ externalSealCommitSha: "d".repeat(40) }),
    verification({ observedCommit: { ...verification().observedCommit, parentSha: "d".repeat(40) } }),
    verification({ observedCommit: { ...verification().observedCommit, commitSha: "d".repeat(40) } }),
    verification({ observedCommit: { ...verification().observedCommit, changes: [{ status: "modified", path: finalSealPath(deliveryId) }] } }),
    verification({ currentProductSha: "d".repeat(40) }),
    verification({ records: { "deliveries/delivery-001/acceptance.json": "alpha" } }),
    verification({ records: { ...records, "deliveries/delivery-001/extra.json": "extra" } }),
    verification({ records: { ...records, "deliveries/delivery-001/review.json": "tampered" } }),
    verification({ sealContents: canonicalSeal().replace(productSha, "d".repeat(40)) }),
  ];
  for (const value of cases) assert.throws(() => verifyFinalLedgerSeal(value as never), (error: unknown) => error instanceof LedgerError && error.code === "ledger-invalid-record");
});

