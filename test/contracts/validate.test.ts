import assert from "node:assert/strict";
import test from "node:test";
import { CONTRACT_VERSION, ContractValidationError, profileFingerprint, validateBinding, validateLifecycleState, validateOperation, validatePathPolicy, validateProfile, validateRemoteExpectation } from "../../src/index.js";

const repository = { owner: "visualjc", name: "development", remote: { name: "origin", url: "https://github.com/visualjc/development.git" }, defaultBranch: "main" };

test("validates a versioned staged-pair profile without changing its topology", () => {
  const profile = validateProfile({ schemaVersion: CONTRACT_VERSION, name: "local", actor: { login: "visualjc" }, topology: { kind: "staged-pair", development: repository, destination: { ...repository, name: "destination", remote: { name: "destination", url: "https://github.com/visualjc/destination.git" } } }, allowedOperations: ["setup", "status"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }] } });
  assert.equal(profile.topology.kind, "staged-pair");
  assert.equal(profile.actor.login, "visualjc");
});

test("validates a single-repository binding", () => {
  const binding = validateBinding({ schemaVersion: 1, profileName: "local", commonDirectory: "/repos/.git", topology: { kind: "single-repository", repository }, profileFingerprint: "0".repeat(64), boundAt: "2026-08-04T03:00:00.000Z" });
  assert.equal(binding.topology.kind, "single-repository");
  assert.equal(binding.commonDirectory, "/repos/.git");
});

test("requires both a named remote and URL for topology identity", () => {
  assert.deepEqual(validateRemoteExpectation({ name: "origin", url: "https://github.com/visualjc/development.git" }), { name: "origin", url: "https://github.com/visualjc/development.git" });
  assert.throws(() => validateRemoteExpectation({ url: "https://github.com/visualjc/development.git" }), (error: unknown) => error instanceof ContractValidationError && error.path === "$.name");
  assert.throws(() => validateRemoteExpectation({ name: "origin" }), (error: unknown) => error instanceof ContractValidationError && error.path === "$.url");
  assert.throws(() => validateProfile({ schemaVersion: 1, name: "local", actor: { login: "visualjc" }, topology: { kind: "staged-pair", development: repository, destination: { ...repository, name: "destination" } }, allowedOperations: ["setup"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }] } }), (error: unknown) => error instanceof ContractValidationError && error.path === "$.topology");
});

test("rejects destination-normalization repository segments before any tracker path can be built", () => {
  for (const unsafe of ["../destination", "acme/destination", "%2fescape", "destination?x=1", "destination#x", ".."])
    assert.throws(() => validateProfile({ schemaVersion: 1, name: "local", actor: { login: "actor" }, topology: { kind: "single-repository", repository: { ...repository, name: unsafe } }, allowedOperations: ["status"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }] } }), ContractValidationError);
});

test("reports stable validation code and path for unsupported schema versions", () => {
  assert.throws(() => validateProfile({ schemaVersion: 2 }), (error: unknown) => error instanceof ContractValidationError && error.code === "unsupported-schema-version" && error.path === "$.schemaVersion" && error.message === "unsupported-schema-version:$.schemaVersion: must equal 1");
});

test("rejects unknown fields and duplicate operations fail closed", () => {
  assert.throws(() => validateProfile({ schemaVersion: 1, name: "x", actor: { login: "a" }, topology: { kind: "single-repository", repository }, allowedOperations: ["status", "status"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }] }, surprise: true }), (error: unknown) => error instanceof ContractValidationError && error.path === "$.surprise");
  assert.throws(() => validateProfile({ schemaVersion: 1, name: "x", actor: { login: "a" }, topology: { kind: "single-repository", repository }, allowedOperations: ["status", "status"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }] } }), (error: unknown) => error instanceof ContractValidationError && error.path === "$.allowedOperations");
  assert.throws(() => validateProfile({ schemaVersion: 1, name: "x", actor: { login: "a" }, topology: { kind: "single-repository", repository }, allowedOperations: ["status"] }), (error: unknown) => error instanceof ContractValidationError && error.path === "$.pathPolicy");
});

test("profile fingerprints are stable across a validated round trip", () => {
  const profile = validateProfile({ schemaVersion: 1, name: "stable", actor: { login: "actor" }, topology: { kind: "single-repository", repository }, allowedOperations: ["setup", "status"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }] } });
  assert.equal(profileFingerprint(profile), profileFingerprint(JSON.parse(JSON.stringify(profile))));
});

test("graph profile is backward-safe disabled by omission and strict when enabled", () => {
  const base = { schemaVersion: 1, name: "stable", actor: { login: "actor" }, topology: { kind: "single-repository", repository }, allowedOperations: ["setup", "status"], pathPolicy: { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }] } };
  assert.equal(profileFingerprint(base), profileFingerprint({ ...base, graph: { enabled: false } }));
  const enabled = validateProfile({ ...base, graph: { enabled: true, localOnlyApproved: true, adapter: "graphify", reviewedToolSource: "graphify@0.9.32#00efd6e7969837ae4a9f11d8d504dcd3b20b09df", executablePath: "/opt/graphify", cacheRoot: "/var/shipyard/graph" } });
  assert.equal(enabled.graph?.enabled, true); assert.notEqual(profileFingerprint(enabled), profileFingerprint(base));
  assert.throws(() => validateProfile({ ...base, graph: { enabled: false, executablePath: "/evil" } }), ContractValidationError);
  assert.throws(() => validateProfile({ ...base, graph: { enabled: true, localOnlyApproved: true, adapter: "graphify", reviewedToolSource: "graphify@latest", executablePath: "/opt/graphify", cacheRoot: "/var/graph" } }), ContractValidationError);
  let called = false; const hostile = Object.create(Object.prototype, { schemaVersion: { enumerable: true, get() { called = true; throw new Error("profile-secret"); } } }); assert.throws(() => validateProfile(hostile), ContractValidationError); assert.equal(called, false);
});

test("validates path policy, operations, and lifecycle timestamps", () => {
  const policy = validatePathPolicy({ schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }, { owner: "scratch", pattern: ".tmp/**" }] });
  assert.equal(policy.rules.length, 2);
  assert.equal(validateOperation("review"), "review");
  assert.equal(validateLifecycleState({ schemaVersion: 1, deliveryId: "D-1", phase: "awaiting-review", productSha: "abc", updatedAt: "2026-08-04T03:00:00.000Z" }).phase, "awaiting-review");
});

test("rejects unsafe policy and lifecycle documents", () => {
  assert.throws(() => validatePathPolicy({ schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**" }, { owner: "scratch", pattern: "src/**" }] }), (error: unknown) => error instanceof ContractValidationError && error.code === "invalid-path-policy");
  assert.throws(() => validateLifecycleState({ schemaVersion: 1, deliveryId: "D-1", phase: "unknown", updatedAt: "not-a-date" }), (error: unknown) => error instanceof ContractValidationError && error.path === "$.phase");
});
