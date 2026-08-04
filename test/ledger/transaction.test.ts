import assert from "node:assert/strict";
import test from "node:test";
import { LedgerError } from "../../src/ledger/errors.js";
import { applyLedgerTransaction } from "../../src/ledger/transaction.js";
import type { LedgerSnapshot } from "../../src/ledger/types.js";

const snapshot = (head: string | undefined, records: Record<string, string> = {}): LedgerSnapshot => ({ head, records });

test("applies independent record writes against the exact expected ledger head", () => {
  const result = applyLedgerTransaction(snapshot("a", { "delivery/a.json": '{"state":"new"}' }), {
    expectedHead: "a", writes: [{ path: "delivery/b.json", contents: '{"state":"new"}' }],
  });
  assert.deepEqual(result, { "delivery/a.json": '{"state":"new"}', "delivery/b.json": '{"state":"new"}' });
});

test("rejects a stale expected head without producing a candidate tree", () => {
  assert.throws(() => applyLedgerTransaction(snapshot("new"), { expectedHead: "old", writes: [] }),
    (error: unknown) => error instanceof LedgerError && error.code === "ledger-stale-head");
});

test("rejects a same-path semantic conflict and leaves explicit retry to the caller", () => {
  assert.throws(() => applyLedgerTransaction(snapshot("a", { "delivery/a.json": "before" }), {
    expectedHead: "a", writes: [{ path: "delivery/a.json", contents: "after", expectedContents: "other" }],
  }), (error: unknown) => error instanceof LedgerError && error.code === "ledger-path-conflict");
});

test("requires expected contents before overwriting an existing ledger record", () => {
  assert.throws(() => applyLedgerTransaction(snapshot("a", { "delivery/a.json": "before" }), { expectedHead: "a", writes: [{ path: "delivery/a.json", contents: "after" }] }),
    (error: unknown) => error instanceof LedgerError && error.code === "ledger-path-conflict");
});

test("rejects unsafe record paths and duplicate writes", () => {
  assert.throws(() => applyLedgerTransaction(snapshot(undefined), { expectedHead: undefined, writes: [{ path: "../escape", contents: "x" }] }), LedgerError);
  assert.throws(() => applyLedgerTransaction(snapshot(undefined), { expectedHead: undefined, writes: [{ path: "same", contents: "x" }, { path: "same", contents: "y" }] }), LedgerError);
});
