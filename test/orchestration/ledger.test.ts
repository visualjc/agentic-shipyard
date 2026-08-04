import assert from "node:assert/strict";
import test from "node:test";
import { PlanningLedger, canonicalPlanningCheckpoint, canonicalProviderCheckpoint, canonicalReviewIntent, checkpointDigest, planningRecordPath } from "../../src/orchestration/ledger.js";

test("planning ledger rejects hostile paths and uses CAS append", async () => {
  assert.throws(() => planningRecordPath("../escape"));
  let head = "a".repeat(40); const records: Record<string, string> = {};
  const ledger = new PlanningLedger({ async snapshot(paths) { return { head, records: Object.fromEntries(paths.flatMap(path => records[path] === undefined ? [] : [[path, records[path]!]])) }; }, async transact(tx) { assert.equal(tx.expectedHead, head); for (const write of tx.writes) records[write.path] = write.contents; head = "b".repeat(40); return head; } });
  const profile = { schemaVersion: 1 as const, name: "v1", actor: { login: "visualjc" }, topology: { kind: "single-repository" as const, repository: { owner: "visualjc", name: "shipyard", remote: { name: "origin", url: "https://github.com/visualjc/shipyard.git" }, defaultBranch: "main" } }, allowedOperations: ["setup", "status"] as const, pathPolicy: { schemaVersion: 1 as const, rules: [] } };
  const checkpoint = { schemaVersion: 1 as const, record: { schemaVersion: 1 as const, recordId: "safe", decision: { schemaVersion: 1 as const, lane: "small" as const, disposition: "ready" as const, reasons: [], planningSequence: ["grill-with-docs", "to-spec"], nextSafeAction: "grill-with-docs" as const }, phase: "classified" as const, dependencyStates: [], blockers: [], nextSafeAction: "grill-with-docs" as const }, pin: { productSha: "c".repeat(40), historicalBaseLedgerSha: "a".repeat(40), profileName: "v1", profileFingerprint: "d".repeat(64), actorLogin: "visualjc" as const, topologyDigest: "e".repeat(64), commonDirectoryDigest: "f".repeat(64), objectFormat: "sha1" as const } };
  await ledger.append(checkpoint);
  assert.equal(Object.keys(records)[0], "planning/safe.json");
  assert.doesNotMatch(records["planning/safe.json"]!, /"binding"|"profile"|"pathPolicy"|"commonDirectory"|"repositoryPath"|"token"|"provider"|"capability"|"shell"|"issue"|"pullRequest"|"merge"|"promotion"/);
  // A lost base-write response is adopted even when a later unrelated ledger head is observed.
  await ledger.append(checkpoint);
  await assert.rejects(() => ledger.append({ ...checkpoint, record: { ...checkpoint.record, phase: "planned" } }));
});

test("provider checkpoint adopts an exact lost response but rejects an orphan or substituted immutable base", async () => {
  let head = "a".repeat(40); const records: Record<string, string> = {};
  const store = { async snapshot(paths: readonly string[]) { return { head, records: Object.fromEntries(paths.flatMap(path => records[path] === undefined ? [] : [[path, records[path]!]])) }; }, async transact(tx: { expectedHead: string | undefined; writes: readonly { path: string; contents: string }[] }) { assert.equal(tx.expectedHead, head); for (const write of tx.writes) records[write.path] = write.contents; head = "b".repeat(40); return head; } };
  const ledger = new PlanningLedger(store);
  const base = { schemaVersion: 1 as const, record: { schemaVersion: 1 as const, recordId: "safe", decision: { schemaVersion: 1 as const, lane: "bug" as const, disposition: "ready" as const, reasons: [], planningSequence: ["diagnosing-bugs"], nextSafeAction: "diagnosing-bugs" as const }, phase: "classified" as const, dependencyStates: [], blockers: [], nextSafeAction: "diagnosing-bugs" as const }, pin: { productSha: "c".repeat(40), historicalBaseLedgerSha: "a".repeat(40), profileName: "v1", profileFingerprint: "d".repeat(64), actorLogin: "visualjc" as const, topologyDigest: "e".repeat(64), commonDirectoryDigest: "f".repeat(64), objectFormat: "sha1" as const } };
  const provider = { schemaVersion: 1 as const, kind: "planning-provider" as const, recordId: "safe", baseDigest: checkpointDigest(base), provider: "codex" as const, phase: "diagnosed" as const, resumeCheckpoint: "done", artifacts: [{ step: "diagnosing-bugs", path: "planning/safe/artifacts/bug.md", sha256: "a".repeat(64) }] };
  const appended = await ledger.append(base); await ledger.appendProvider(base, provider, appended.ledgerHead); const adopted = await ledger.appendProvider(base, provider, "f".repeat(40)); assert.equal(adopted, head);
  records["planning/safe.json"] = "{}"; await assert.rejects(() => ledger.appendProvider(base, provider, head));
});

test("review intent adopts only its exact child bytes and requires its immutable base", async () => {
  let head = "a".repeat(40); const records: Record<string, string> = {};
  const store = { async snapshot(paths: readonly string[]) { return { head, records: Object.fromEntries(paths.flatMap(path => records[path] === undefined ? [] : [[path, records[path]!]])) }; }, async transact(tx: { expectedHead: string | undefined; writes: readonly { path: string; contents: string }[] }) { for (const write of tx.writes) records[write.path] = write.contents; head = "b".repeat(40); return head; } };
  const ledger = new PlanningLedger(store);
  const base = { schemaVersion: 1 as const, record: { schemaVersion: 1 as const, recordId: "review", decision: { schemaVersion: 1 as const, lane: "review-only" as const, disposition: "ready" as const, reasons: [{ code: "requested", evidence: "exact-head" }], planningSequence: ["scoped-review"], nextSafeAction: "scoped-review" as const }, phase: "classified" as const, dependencyStates: [], blockers: [], nextSafeAction: "scoped-review" as const }, pin: { productSha: "c".repeat(40), historicalBaseLedgerSha: "a".repeat(40), profileName: "v1", profileFingerprint: "d".repeat(64), actorLogin: "visualjc" as const, topologyDigest: "e".repeat(64), commonDirectoryDigest: "f".repeat(64), objectFormat: "sha1" as const } };
  const intent = { schemaVersion: 1 as const, kind: "review-intent" as const, recordId: "review", baseDigest: checkpointDigest(base), target: { owner: "visualjc", name: "shipyard", number: 1, url: "https://github.com/visualjc/shipyard/pull/1", baseBranch: "main", headSha: "f".repeat(40) } };
  const appended = await ledger.append(base); await ledger.appendReview(base, intent, appended.ledgerHead); await ledger.appendReview(base, intent, "f".repeat(40));
  records["planning/review/review-intent.json"] = "{}"; await assert.rejects(() => ledger.appendReview(base, intent, head));
});

test("provider artifacts are exact immutable lane steps: no substitution, reordering, extras, or unsafe paths", () => {
  const base = { schemaVersion: 1 as const, record: { schemaVersion: 1 as const, recordId: "small", decision: { schemaVersion: 1 as const, lane: "small" as const, disposition: "ready" as const, reasons: [], planningSequence: ["grill-with-docs", "to-spec"], nextSafeAction: "grill-with-docs" as const }, phase: "classified" as const, dependencyStates: [], blockers: [], nextSafeAction: "grill-with-docs" as const }, pin: { productSha: "c".repeat(40), historicalBaseLedgerSha: "a".repeat(40), profileName: "v1", profileFingerprint: "d".repeat(64), actorLogin: "visualjc" as const, topologyDigest: "e".repeat(64), commonDirectoryDigest: "f".repeat(64), objectFormat: "sha1" as const } };
  const provider = { schemaVersion: 1 as const, kind: "planning-provider" as const, recordId: "small", baseDigest: checkpointDigest(base), provider: "codex" as const, phase: "planned" as const, resumeCheckpoint: "done", artifacts: [{ step: "grill-with-docs", path: "planning/small/artifacts/grill.md", sha256: "a".repeat(64) }, { step: "to-spec", path: "planning/small/artifacts/spec.md", sha256: "b".repeat(64) }] };
  assert.doesNotThrow(() => canonicalProviderCheckpoint(provider, base));
  assert.throws(() => canonicalProviderCheckpoint({ ...provider, artifacts: [...provider.artifacts].reverse() }, base));
  assert.throws(() => canonicalProviderCheckpoint({ ...provider, artifacts: [...provider.artifacts, { step: "to-tickets", path: "planning/small/artifacts/tasks.md", sha256: "c".repeat(64) }] }, base));
  assert.throws(() => canonicalProviderCheckpoint({ ...provider, artifacts: [{ ...provider.artifacts[0]!, step: "wayfinder" }, provider.artifacts[1]!] }, base));
  assert.throws(() => canonicalProviderCheckpoint({ ...provider, artifacts: [{ ...provider.artifacts[0]!, path: "planning/small/artifacts/../escape.md" }, provider.artifacts[1]!] }, base));
});

test("planning and review canonical pins require exact SHA-1/SHA-256 widths", () => {
  const base = (format: "sha1" | "sha256", productLength: number, ledgerLength: number) => ({ schemaVersion: 1 as const, record: { schemaVersion: 1 as const, recordId: "width", decision: { schemaVersion: 1 as const, lane: "review-only" as const, disposition: "ready" as const, reasons: [{ code: "requested", evidence: "exact" }], planningSequence: ["scoped-review"], nextSafeAction: "scoped-review" as const }, phase: "classified" as const, dependencyStates: [], blockers: [], nextSafeAction: "scoped-review" as const }, pin: { productSha: "a".repeat(productLength), historicalBaseLedgerSha: "b".repeat(ledgerLength), profileName: "v1", profileFingerprint: "c".repeat(64), actorLogin: "visualjc" as const, topologyDigest: "d".repeat(64), commonDirectoryDigest: "e".repeat(64), objectFormat: format } });
  const one = base("sha1", 40, 40), two = base("sha256", 64, 64); assert.doesNotThrow(() => canonicalPlanningCheckpoint(one)); assert.doesNotThrow(() => canonicalPlanningCheckpoint(two));
  for (const length of [39, 41, 63, 65]) { assert.throws(() => canonicalPlanningCheckpoint(base("sha1", length, 40))); assert.throws(() => canonicalPlanningCheckpoint(base("sha1", 40, length))); assert.throws(() => canonicalPlanningCheckpoint(base("sha256", length, 64))); assert.throws(() => canonicalPlanningCheckpoint(base("sha256", 64, length))); }
  const review = (checkpoint: typeof one | typeof two, headLength: number) => ({ schemaVersion: 1 as const, kind: "review-intent" as const, recordId: "width", baseDigest: checkpointDigest(checkpoint), target: { owner: "visualjc", name: "shipyard", number: 1, url: "https://github.com/visualjc/shipyard/pull/1", baseBranch: "main", headSha: "f".repeat(headLength) } });
  assert.doesNotThrow(() => canonicalReviewIntent(review(one, 40), one)); assert.doesNotThrow(() => canonicalReviewIntent(review(two, 64), two)); for (const length of [39, 41, 63, 65]) { assert.throws(() => canonicalReviewIntent(review(one, length), one)); assert.throws(() => canonicalReviewIntent(review(two, length), two)); }
});

test("planning documents reject hidden fields and accessors without invoking getters", () => {
  const checkpoint = { schemaVersion: 1 as const, record: { schemaVersion: 1 as const, recordId: "hidden", decision: { schemaVersion: 1 as const, lane: "small" as const, disposition: "ready" as const, reasons: [], planningSequence: ["grill-with-docs", "to-spec"], nextSafeAction: "grill-with-docs" as const }, phase: "classified" as const, dependencyStates: [], blockers: [], nextSafeAction: "grill-with-docs" as const }, pin: { productSha: "c".repeat(40), historicalBaseLedgerSha: "a".repeat(40), profileName: "v1", profileFingerprint: "d".repeat(64), actorLogin: "visualjc" as const, topologyDigest: "e".repeat(64), commonDirectoryDigest: "f".repeat(64), objectFormat: "sha1" as const } };
  const clone = <T>(value: T): T => structuredClone(value);
  const hide = (object: object, key: string) => Object.defineProperty(object, key, { value: (object as Record<string, unknown>)[key], enumerable: false, configurable: true, writable: true });
  const hiddenPin = clone(checkpoint); hide(hiddenPin.pin, "productSha"); assert.throws(() => canonicalPlanningCheckpoint(hiddenPin));
  const hiddenRecord = clone(checkpoint); hide(hiddenRecord.record, "recordId"); assert.throws(() => canonicalPlanningCheckpoint(hiddenRecord));
  const provider = { schemaVersion: 1 as const, kind: "planning-provider" as const, recordId: "hidden", baseDigest: checkpointDigest(checkpoint), provider: "codex" as const, phase: "planned" as const, resumeCheckpoint: "done", artifacts: [{ step: "grill-with-docs", path: "planning/hidden/artifacts/grill.md", sha256: "a".repeat(64) }, { step: "to-spec", path: "planning/hidden/artifacts/spec.md", sha256: "b".repeat(64) }] };
  const hiddenArtifact = clone(provider); hide(hiddenArtifact.artifacts[0]!, "step"); assert.throws(() => canonicalProviderCheckpoint(hiddenArtifact, checkpoint));
  const review = { schemaVersion: 1 as const, kind: "review-intent" as const, recordId: "hidden", baseDigest: checkpointDigest(checkpoint), target: { owner: "visualjc", name: "shipyard", number: 1, url: "https://github.com/visualjc/shipyard/pull/1", baseBranch: "main", headSha: "f".repeat(40) } };
  const hiddenTarget = clone(review); hide(hiddenTarget.target, "headSha"); assert.throws(() => canonicalReviewIntent(hiddenTarget, checkpoint));
  let reads = 0; const accessor = clone(checkpoint); Object.defineProperty(accessor.pin, "productSha", { enumerable: true, configurable: true, get() { reads += 1; return "c".repeat(40); } }); assert.throws(() => canonicalPlanningCheckpoint(accessor)); assert.equal(reads, 0);
  const symbol = clone(checkpoint); Object.defineProperty(symbol.pin, Symbol("hidden"), { value: true, enumerable: true }); assert.throws(() => canonicalPlanningCheckpoint(symbol));
});

test("planning ledger rejects hostile dependency states and duplicate dependency names", () => {
  const checkpoint = { schemaVersion: 1 as const, record: { schemaVersion: 1 as const, recordId: "dependencies", decision: { schemaVersion: 1 as const, lane: "small" as const, disposition: "ready" as const, reasons: [], planningSequence: ["grill-with-docs", "to-spec"], nextSafeAction: "grill-with-docs" as const }, phase: "classified" as const, dependencyStates: [{ dependency: "ccpm", state: "ready" as const }], blockers: [], nextSafeAction: "grill-with-docs" as const }, pin: { productSha: "c".repeat(40), historicalBaseLedgerSha: "a".repeat(40), profileName: "v1", profileFingerprint: "d".repeat(64), actorLogin: "visualjc" as const, topologyDigest: "e".repeat(64), commonDirectoryDigest: "f".repeat(64), objectFormat: "sha1" as const } };
  assert.doesNotThrow(() => canonicalPlanningCheckpoint(checkpoint));
  assert.throws(() => canonicalPlanningCheckpoint({ ...checkpoint, record: { ...checkpoint.record, dependencyStates: [{ dependency: "ccpm", state: "invented" }] } } as never));
  assert.throws(() => canonicalPlanningCheckpoint({ ...checkpoint, record: { ...checkpoint.record, dependencyStates: [{ dependency: "ccpm", state: "ready" }, { dependency: "ccpm", state: "missing" }] } }));
});
