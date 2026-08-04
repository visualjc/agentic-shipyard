import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceProofRecord, parseWorkspaceProofRecord, serializeWorkspaceProofRecord } from "../../src/workspace/proof.js";
import type { DeliveryWorkspace } from "../../src/delivery/types.js";

const workspace: DeliveryWorkspace = {
  schemaVersion: 1,
  state: "creating",
  creationToken: "11111111-1111-4111-8111-111111111111",
  deliveryId: "d-1",
  commonDirectory: "/repository/.git",
  branch: "shipyard/d-1",
  worktreePath: "/worktrees/d-1",
};

test("workspace proof records require exact canonical versioned blob bytes", () => {
  const record = createWorkspaceProofRecord("ownership", workspace, "a".repeat(40));
  const canonical = serializeWorkspaceProofRecord(record);
  assert.deepEqual(parseWorkspaceProofRecord(canonical), record);
  assert.equal(parseWorkspaceProofRecord(`${canonical}\n`), undefined);
  assert.equal(parseWorkspaceProofRecord(JSON.stringify({ ...record, extra: true })), undefined);
  assert.equal(parseWorkspaceProofRecord(JSON.stringify({ kind: record.kind, schemaVersion: 1, creationToken: record.creationToken, deliveryId: record.deliveryId, commonDirectory: record.commonDirectory, branch: record.branch, worktreePath: record.worktreePath, startProductSha: record.startProductSha })), undefined);
  assert.equal(parseWorkspaceProofRecord(JSON.stringify({ ...record, startProductSha: "not-a-sha" })), undefined);
  assert.equal(parseWorkspaceProofRecord(JSON.stringify({ ...record, worktreePath: `${record.worktreePath}/` })), undefined);
});

test("workspace proof records preserve SHA-256 start identities", () => {
  const record = createWorkspaceProofRecord("readiness", workspace, "b".repeat(64));
  assert.deepEqual(parseWorkspaceProofRecord(serializeWorkspaceProofRecord(record)), record);
});
