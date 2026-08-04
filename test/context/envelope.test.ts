import assert from "node:assert/strict";
import test from "node:test";
import { createEnvelope, validateContextEnvelope } from "../../src/context/envelope.js";
import { ContextError } from "../../src/context/errors.js";

const base = {
  host: "codex",
  deliveryId: "delivery-001",
  profile: "local",
  topology: { kind: "single-repository", repository: { owner: "acme", name: "widget", remote: { name: "origin", url: "https://example.test/widget.git" }, defaultBranch: "main" } },
  repository: { owner: "acme", name: "widget", remote: { name: "origin", url: "https://example.test/widget.git" }, defaultBranch: "main" },
  productBranch: "shipyard/delivery-001",
  objectFormat: "sha1",
  productSha: "a".repeat(40),
  ledgerRef: "refs/heads/shipyard-ledger",
  ledgerSha: "b".repeat(40),
  envelopePath: ".shipyard/envelopes/delivery-001.json",
  repoRoot: "/worktrees/delivery-001",
} as const;

test("creates deeply immutable envelopes with each role's exact record-path allowlist", () => {
  const implementer = createEnvelope({ ...base, role: "implementer" });
  const reviewer = createEnvelope({ ...base, role: "reviewer" });
  const status = createEnvelope({ ...base, role: "status" });

  assert.deepEqual(implementer.records, ["deliveries/delivery-001/contract.md", "deliveries/delivery-001/assigned-task.md"]);
  assert.deepEqual(reviewer.records, ["deliveries/delivery-001/intent.md", "deliveries/delivery-001/acceptance.json", "deliveries/delivery-001/review.json"]);
  assert.deepEqual(status.records, []);
  assert.deepEqual(implementer.adapter, { host: "codex", role: "implementer", envelopePath: ".shipyard/envelopes/delivery-001.json", repoRoot: "/worktrees/delivery-001" });
  assert.ok(Object.isFrozen(implementer));
  assert.ok(Object.isFrozen(implementer.repository));
  assert.ok(Object.isFrozen(implementer.records));
  assert.throws(() => (implementer.records as string[]).push("deliveries/delivery-001/review.json"), TypeError);
});

test("rejects path or role attempts that broaden the fixed allowlist", () => {
  assert.throws(() => createEnvelope({ ...base, role: "status", records: ["deliveries/delivery-001/review.json"] }),
    (error: unknown) => error instanceof ContextError && error.code === "context-records-not-allowed");
  assert.throws(() => createEnvelope({ ...base, role: "implementer", deliveryId: "../escape" }),
    (error: unknown) => error instanceof ContextError && error.code === "context-invalid-envelope");
});

test("rejects non-canonical pins and a repository not selected by the topology", () => {
  assert.throws(() => createEnvelope({ ...base, role: "implementer", productSha: "A".repeat(40) }),
    (error: unknown) => error instanceof ContextError && error.code === "context-invalid-envelope");
  assert.throws(() => createEnvelope({ ...base, role: "implementer", ledgerSha: "a".repeat(39) }),
    (error: unknown) => error instanceof ContextError && error.code === "context-invalid-envelope");
  assert.throws(() => createEnvelope({ ...base, role: "implementer", objectFormat: "sha256", ledgerSha: "a".repeat(40) }),
    (error: unknown) => error instanceof ContextError && error.code === "context-invalid-envelope");
  assert.throws(() => createEnvelope({ ...base, role: "implementer", ledgerRef: "refs/heads/other" }),
    (error: unknown) => error instanceof ContextError && error.code === "context-invalid-envelope");
  assert.throws(() => createEnvelope({ ...base, role: "implementer", repository: { ...base.repository, name: "other" } }),
    (error: unknown) => error instanceof ContextError && error.code === "context-repository-mismatch");
});

test("requires staged-pair envelopes to name the development repository", () => {
  const topology = { kind: "staged-pair" as const, development: base.repository, destination: { ...base.repository, name: "destination", remote: { name: "destination", url: "https://example.test/destination.git" } } };
  assert.throws(() => createEnvelope({ ...base, role: "implementer", topology, repository: topology.destination }),
    (error: unknown) => error instanceof ContextError && error.code === "context-repository-mismatch");
  assert.equal(createEnvelope({ ...base, role: "implementer", topology, repository: topology.development }).repository.name, "widget");
});

test("validates serialized envelopes deeply and returns an independent immutable snapshot", () => {
  const envelope = createEnvelope({ ...base, role: "reviewer" });
  const serialized = structuredClone(envelope);
  const restored = validateContextEnvelope(serialized);
  (serialized.repository as { owner: string }).owner = "mutated";
  assert.equal(restored.repository.owner, "acme");
  assert.ok(Object.isFrozen(restored.adapter));
  assert.throws(() => validateContextEnvelope({ ...serialized, topology: { kind: "single-repository" } }),
    (error: unknown) => error instanceof ContextError && error.code === "context-invalid-envelope");
});
