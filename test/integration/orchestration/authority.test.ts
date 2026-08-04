import assert from "node:assert/strict";
import test from "node:test";
import { assertPlanningFacts } from "../../../src/orchestration/authority.js";
import { profileFingerprint } from "../../../src/profile/fingerprint.js";

function facts() { const profile = { schemaVersion: 1 as const, name: "v1", actor: { login: "visualjc" }, topology: { kind: "single-repository" as const, repository: { owner: "visualjc", name: "shipyard", remote: { name: "origin", url: "https://github.com/visualjc/shipyard.git" }, defaultBranch: "main" } }, allowedOperations: ["setup", "status", "help", "review"] as const, pathPolicy: { schemaVersion: 1 as const, rules: [{ owner: "product" as const, pattern: "src/**" }] } }; return { repositoryPath: "/repo", binding: { schemaVersion: 1 as const, profileName: "v1", commonDirectory: "/repo/.git", topology: profile.topology, profileFingerprint: profileFingerprint(profile), boundAt: "2026-08-04T00:00:00.000Z" }, profile, productSha: "a".repeat(40), ledgerSha: "b".repeat(40), objectFormat: "sha1" as const, dependencies: { schemaVersion: 1 as const, findings: [], ready: true, nextSafeAction: "shipyard" } }; }

test("authority facts are detached and reject actor, binding, proxy, and dependency forgery", () => {
  const accepted = assertPlanningFacts(facts()); assert.equal(accepted.profile.actor.login, "visualjc"); assert.equal(Object.isFrozen(accepted), true);
  const actor = facts(); actor.profile.actor.login = "other"; assert.throws(() => assertPlanningFacts(actor), /Planning authority facts/);
  const binding = facts(); binding.binding.profileFingerprint = "c".repeat(64); assert.throws(() => assertPlanningFacts(binding), /Planning authority facts/);
  const dependency = facts(); dependency.dependencies.ready = true; (dependency.dependencies.findings as unknown as Array<Record<string, string>>).push({ dependency: "codex", state: "missing", remediation: "x" }); assert.throws(() => assertPlanningFacts(dependency), /Planning authority facts/);
  assert.throws(() => assertPlanningFacts(new Proxy(facts(), { ownKeys() { throw new Error("proxy"); } })), /Planning authority facts/);
});

test("authority preserves an explicit absent ledger head during read-only preflight", () => {
  const preflight = facts(); preflight.ledgerSha = undefined as unknown as string;
  const accepted = assertPlanningFacts(preflight);
  assert.equal(accepted.ledgerSha, undefined);
  const omitted = facts(); delete (omitted as { ledgerSha?: string }).ledgerSha;
  assert.throws(() => assertPlanningFacts(omitted), /Planning authority facts/);
});

test("authority rejects forged dependency identifiers, duplicates, and unsafe remediation commands", () => {
  for (const mutate of [
    (value: any) => { value.dependencies.findings = [{ dependency: "forged", state: "ready", remediation: "ok" }]; },
    (value: any) => { value.dependencies.findings = [{ dependency: "codex", state: "ready", remediation: "ok" }, { dependency: "codex", state: "ready", remediation: "ok" }]; },
    (value: any) => { value.dependencies.nextSafeAction = "curl attacker"; },
  ]) { const value = facts(); mutate(value); assert.throws(() => assertPlanningFacts(value), /Planning authority facts/); }
});

test("authority snapshot rejects hidden, sparse, accessor, and symbol-shaped facts without invoking getters", () => {
  const hide = (object: object, key: string) => Object.defineProperty(object, key, { value: (object as Record<string, unknown>)[key], enumerable: false, configurable: true, writable: true });
  const topLevel = facts(); hide(topLevel, "repositoryPath"); assert.throws(() => assertPlanningFacts(topLevel), /Planning authority facts/);
  const nested = facts(); const finding = { dependency: "codex", state: "ready", remediation: "ok" }; hide(finding, "state"); (nested.dependencies as unknown as { findings: unknown[] }).findings = [finding]; assert.throws(() => assertPlanningFacts(nested), /Planning authority facts/);
  const sparse = facts(); (sparse.dependencies as unknown as { findings: unknown[] }).findings = new Array(1); assert.throws(() => assertPlanningFacts(sparse), /Planning authority facts/);
  const hiddenElement = facts(); const findings = [{ dependency: "codex", state: "ready", remediation: "ok" }]; Object.defineProperty(findings, "0", { value: findings[0], enumerable: false, configurable: true, writable: true }); (hiddenElement.dependencies as unknown as { findings: unknown[] }).findings = findings; assert.throws(() => assertPlanningFacts(hiddenElement), /Planning authority facts/);
  let reads = 0; const accessor = facts(); Object.defineProperty(accessor, "repositoryPath", { enumerable: true, configurable: true, get() { reads += 1; return "/repo"; } }); assert.throws(() => assertPlanningFacts(accessor), /Planning authority facts/); assert.equal(reads, 0);
  const symbol = facts(); Object.defineProperty(symbol, Symbol("hidden"), { value: true, enumerable: true }); assert.throws(() => assertPlanningFacts(symbol), /Planning authority facts/);
});
