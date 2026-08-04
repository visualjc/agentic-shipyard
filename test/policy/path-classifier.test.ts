import assert from "node:assert/strict";
import test from "node:test";
import { ContractValidationError } from "../../src/contracts/errors.js";
import { PathPolicy, Profile } from "../../src/contracts/types.js";
import { PathPolicyError, classifyPath, classifyProfilePath } from "../../src/policy/path-classifier.js";

const policy: PathPolicy = { schemaVersion: 1, rules: [
  { owner: "product", pattern: "src/**" },
  { owner: "development-record", pattern: ".claude/**" },
  { owner: "development-generated", pattern: ".shipyard/generated/**" },
  { owner: "destination-only", pattern: ".github/**" },
  { owner: "context-overlay", pattern: ".shipyard/context/**" },
  { owner: "scratch", pattern: ".shipyard/scratch/**" },
] };

test("classifies every Shipyard ownership behavior through one reusable function", () => {
  const cases: Array<[string, string]> = [
    ["src/index.ts", "product"], [".claude/epics/2.md", "development-record"],
    [".shipyard/generated/graph.json", "development-generated"], [".github/PULL_REQUEST_TEMPLATE.md", "destination-only"],
    [".shipyard/context/implementer.md", "context-overlay"], [".shipyard/scratch/notes.txt", "scratch"],
  ];
  for (const [path, expected] of cases) assert.equal(classifyPath(policy, path), expected, path);
});

test("fails closed for unclassified, conflicting, and unsafe paths", () => {
  const conflict: PathPolicy = { schemaVersion: 1, rules: [...policy.rules, { owner: "scratch", pattern: "src/*" }] };
  const cases: Array<[PathPolicy, string, PathPolicyError["code"]]> = [
    [policy, "README.md", "unclassified-path"], [conflict, "src/index.ts", "conflicting-path-ownership"], [policy, "../token", "invalid-path"],
  ];
  for (const [candidate, path, code] of cases) assert.throws(() => classifyPath(candidate, path), (error: unknown) => error instanceof PathPolicyError && error.code === code);
});

test("validates the canonical path-policy contract at the enforcement seam", () => {
  const hostile = [
    { version: 1, rules: [{ owner: "product", pattern: "src/**" }] },
    { schemaVersion: 1, rules: [{ owner: "not-an-owner", pattern: "src/**" }] },
    { schemaVersion: 1, rules: [{ owner: "product", pattern: "src/**", surprise: true }] },
  ];
  for (const candidate of hostile) {
    assert.throws(() => classifyPath(candidate as PathPolicy, "src/index.ts"), (error: unknown) => error instanceof ContractValidationError && error.code === "invalid-path-policy");
  }
});

test("operational classification takes authority from the profile-owned policy", () => {
  const profile: Profile = { schemaVersion: 1, name: "profile", actor: { login: "actor" }, topology: { kind: "single-repository", repository: { owner: "owner", name: "repo", remote: { name: "origin", url: "https://example.test/repo.git" }, defaultBranch: "main" } }, allowedOperations: ["status"], pathPolicy: policy };
  assert.equal(classifyProfilePath(profile, "src/index.ts"), "product");
  assert.throws(() => classifyProfilePath({ ...profile, pathPolicy: undefined as never }, "src/index.ts"), ContractValidationError);
});
