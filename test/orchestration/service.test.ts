import assert from "node:assert/strict";
import test from "node:test";
import { PlanningLedger } from "../../src/orchestration/ledger.js";
import { ShipyardOrchestrator } from "../../src/orchestration/service.js";
import { profileFingerprint } from "../../src/profile/fingerprint.js";

const sha = (char: string, length = 40) => char.repeat(length);
function harness(classification: unknown, hooks: Readonly<{ matt?: () => void; ccpm?: () => void; review?: () => void }> = {}, scope = "default") {
  let head = sha("b"), writes = 0, ledgerCalls = 0, calls = 0, reviewCalls = 0, classifications = 0, drift: "" | "ledger" | "dependencies" | "commonDirectory" | "objectFormat" = "", currentClassification = classification; const records: Record<string, string> = {}, lanes: Array<string | undefined> = [];
  const profileName = scope === "default" ? "v1" : `v1-${scope}`, repositoryName = scope === "default" ? "shipyard" : `shipyard-${scope}`;
  const profile = { schemaVersion: 1 as const, name: profileName, actor: { login: "visualjc" }, topology: { kind: "single-repository" as const, repository: { owner: "visualjc", name: repositoryName, remote: { name: "origin", url: `https://github.com/visualjc/${repositoryName}.git` }, defaultBranch: "main" } }, allowedOperations: ["setup", "status", "help", "review", "promote", "finalize"] as const, pathPolicy: { schemaVersion: 1 as const, rules: [{ owner: "product" as const, pattern: "src/**" }] } };
  const facts = () => { const wide = drift === "objectFormat", dependencies = drift === "dependencies" ? { schemaVersion: 1 as const, findings: [{ dependency: "matt-skills" as const, state: "missing" as const, remediation: "Install the reviewed receipt." }], ready: false, nextSafeAction: "shipyard-setup" } : { schemaVersion: 1 as const, findings: [], ready: true, nextSafeAction: "shipyard" }; return { repositoryPath: "/repo", binding: { schemaVersion: 1 as const, profileName, commonDirectory: drift === "commonDirectory" ? "/changed/.git" : "/repo/.git", topology: profile.topology, profileFingerprint: profileFingerprint(profile), boundAt: "2026-08-04T00:00:00.000Z" }, profile, productSha: wide ? sha("a", 64) : sha("a"), ledgerSha: drift === "ledger" ? sha("f") : wide ? sha("b", 64) : head, objectFormat: wide ? "sha256" as const : "sha1" as const, dependencies }; };
  const store = { async snapshot(paths: readonly string[]) { ledgerCalls += 1; return { head, records: Object.fromEntries(paths.flatMap(path => records[path] === undefined ? [] : [[path, records[path]!]])) }; }, async transact(transaction: { expectedHead: string | undefined; writes: readonly { path: string; contents: string }[] }) { ledgerCalls += 1; assert.equal(transaction.expectedHead, head); for (const write of transaction.writes) records[write.path] = write.contents; writes += 1; head = sha(writes === 1 ? "d" : "e"); return head; } };
  const codex = { matt: { async plan(envelope: any) { calls += 1; hooks.matt?.(); assert.equal(envelope.role, "planner"); assert.deepEqual(Object.keys(envelope).sort(), ["lane", "objectFormat", "productSha", "recordId", "repositoryPath", "requestText", "role", "steps"]); assert.equal(JSON.stringify(envelope).match(/token|binding|profile|ledger|provider|shell|issue|pull|merge|promotion|finalization/), null); return { resumeCheckpoint: "matt", artifacts: envelope.steps.map((step: string, index: number) => ({ step, path: `planning/${envelope.recordId}/artifacts/matt-${index}.md`, sha256: "a".repeat(64) })) }; } }, ccpm: { async synthesize(envelope: any) { calls += 1; hooks.ccpm?.(); assert.deepEqual(envelope.steps, ["ccpm-prd", "ccpm-vertical-tasks"]); assert.deepEqual(Object.keys(envelope).sort(), ["acceptanceAuthority", "objectFormat", "productSha", "recordId", "repositoryPath", "requestText", "role", "steps"]); return { resumeCheckpoint: "ccpm", acceptanceAuthority: false as const, artifacts: envelope.steps.map((step: string, index: number) => ({ step, path: `planning/${envelope.recordId}/artifacts/ccpm-${index}.md`, sha256: "b".repeat(64) })) }; } } };
  const service = new ShipyardOrchestrator({ async resolve(path, lane) { assert.equal(path, "/repo"); lanes.push(lane); return facts(); } }, { async classify() { classifications += 1; return typeof currentClassification === "function" ? currentClassification() : currentClassification; } }, new PlanningLedger(store), codex, { async observe(input) { reviewCalls += 1; hooks.review?.(); return { number: input.number, url: `https://github.com/${input.owner}/${input.name}/pull/${input.number}`, headSha: input.requestedHead, baseBranch: "main", owner: input.owner, name: "shipyard" }; } });
  return { service, codex, setClassification(value: unknown) { currentClassification = value; }, setDrift(value: typeof drift) { drift = value; }, advanceLedger() { head = sha("f"); }, get calls() { return calls; }, get writes() { return writes; }, get ledgerCalls() { return ledgerCalls; }, get classifications() { return classifications; }, get reviewCalls() { return reviewCalls; }, get lanes() { return lanes; } };
}

test("large lane persists immutable checkpoint and passes only typed planner envelopes", async () => {
  const h = harness({ kind: "feature", scope: "foggy", requirements: "compatible", reasons: [{ code: "fog", evidence: "unknown integration boundary" }] });
  const status = await h.service.start({ requestText: "add capability", repositoryPath: "/repo" });
  assert.equal(status.phase, "planned");
  assert.equal(status.provider?.id, "codex");
  assert.equal(h.calls, 2);
  assert.equal(h.writes, 2);
  assert.ok(h.lanes.includes("large"), "all post-selection validation must resolve the large lane");
});

test("small, bug, review, and resume resolve the checkpoint's exact lane", async () => {
  const cases = [
    { decision: { kind: "feature", scope: "settled", requirements: "compatible", reasons: [{ code: "small", evidence: "bounded" }] }, lane: "small" },
    { decision: { kind: "bug", scope: "settled", requirements: "compatible", regression: "proven", reasons: [{ code: "bug", evidence: "reproduction" }] }, lane: "bug" },
    { decision: { kind: "review", scope: "settled", requirements: "compatible", requestedHead: sha("f"), reasons: [{ code: "review", evidence: "exact" }] }, lane: "review-only", reviewTarget: { number: 1, url: "https://github.com/visualjc/shipyard/pull/1", headSha: sha("f"), baseBranch: "main", owner: "visualjc", name: "shipyard" } },
  ] as const;
  for (const item of cases) {
    const h = harness("reviewTarget" in item ? { decision: item.decision, reviewTarget: item.reviewTarget } : item.decision);
    const started = await h.service.start({ requestText: item.lane, repositoryPath: "/repo" });
    await h.service.resume({ deliveryId: started.recordId, repositoryPath: "/repo" });
    assert.ok(h.lanes.filter(lane => lane === item.lane).length >= 2, `${item.lane} must be selected for both dispatch and resume`);
  }
});

test("start derives an opaque stable record ID and adopts an exact retry", async () => {
  const decision = { kind: "feature", scope: "settled", requirements: "compatible", reasons: [{ code: "ok", evidence: "bounded" }] };
  const h = harness(decision);
  const first = await h.service.start({ requestText: "add capability", repositoryPath: "/repo" });
  const retry = await h.service.start({ requestText: "add capability", repositoryPath: "/repo" });
  const changedRequest = await harness(decision).service.start({ requestText: "add a different capability", repositoryPath: "/repo" });
  const changedScope = await harness(decision, {}, "other").service.start({ requestText: "add capability", repositoryPath: "/repo" });
  assert.match(first.recordId, /^plan-[a-f0-9]{64}$/);
  assert.equal(retry.recordId, first.recordId);
  assert.equal(h.writes, 2, "retry adopts the durable base/provider records without writes");
  assert.notEqual(changedRequest.recordId, first.recordId);
  assert.notEqual(changedScope.recordId, first.recordId);
});

test("a retry after a base-only lost response completes each pending provider or review child", async () => {
  const cases = [
    { requestText: "small", decision: { kind: "feature", scope: "settled", requirements: "compatible", reasons: [{ code: "ok", evidence: "bounded" }] }, phase: "planned" },
    { requestText: "large", decision: { kind: "feature", scope: "foggy", requirements: "compatible", reasons: [{ code: "fog", evidence: "unknown" }] }, phase: "planned" },
    { requestText: "bug", decision: { kind: "bug", scope: "settled", requirements: "compatible", regression: "proven", reasons: [{ code: "proof", evidence: "reproduction" }] }, phase: "diagnosed" },
  ] as const;
  for (const item of cases) {
    const h = harness(item.decision), original = (h.service as any).codex;
    (h.service as any).codex = { matt: { async plan() { throw new Error("lost response"); } }, ccpm: original.ccpm };
    await assert.rejects(() => h.service.start({ requestText: item.requestText, repositoryPath: "/repo" }), /Planning provider could not be completed/);
    assert.equal(h.writes, 1, "only immutable base exists after the lost response");
    (h.service as any).codex = original;
    const retry = await h.service.start({ requestText: item.requestText, repositoryPath: "/repo" });
    assert.equal(retry.phase, item.phase); assert.equal(h.writes, 2, "retry writes only the missing child");
  }
  const target = { number: 1, url: "https://github.com/visualjc/shipyard/pull/1", headSha: sha("f"), baseBranch: "main", owner: "visualjc", name: "shipyard" };
  const review = harness({ decision: { kind: "review", scope: "settled", requirements: "compatible", requestedHead: sha("f"), reasons: [{ code: "requested", evidence: "exact" }] }, reviewTarget: target });
  const observer = (review.service as any).reviews;
  (review.service as any).reviews = { async observe() { throw new Error("lost response"); } };
  await assert.rejects(() => review.service.start({ requestText: "review", repositoryPath: "/repo" }), /Review target observation could not be completed/);
  assert.equal(review.writes, 1);
  (review.service as any).reviews = observer;
  const retry = await review.service.start({ requestText: "review", repositoryPath: "/repo" });
  assert.equal(retry.phase, "review-intent-recorded"); assert.equal(review.writes, 2);
});

test("a retry whose classification or review target conflicts with its immutable base cannot write a child", async () => {
  const ready = { kind: "feature", scope: "settled", requirements: "compatible", reasons: [{ code: "ok", evidence: "bounded" }] };
  const h = harness(ready), original = (h.service as any).codex;
  (h.service as any).codex = { matt: { async plan() { throw new Error("lost response"); } }, ccpm: original.ccpm };
  await assert.rejects(() => h.service.start({ requestText: "same", repositoryPath: "/repo" }));
  h.setClassification({ kind: "feature", scope: "foggy", requirements: "compatible", reasons: [{ code: "fog", evidence: "changed" }] }); (h.service as any).codex = original;
  await assert.rejects(() => h.service.start({ requestText: "same", repositoryPath: "/repo" }), /Planning retry does not match the immutable record/); assert.equal(h.writes, 1);

  const target = { number: 1, url: "https://github.com/visualjc/shipyard/pull/1", headSha: sha("f"), baseBranch: "main", owner: "visualjc", name: "shipyard" };
  const review = harness({ decision: { kind: "review", scope: "settled", requirements: "compatible", requestedHead: sha("f"), reasons: [{ code: "requested", evidence: "exact" }] }, reviewTarget: target });
  (review.service as any).reviews = { async observe() { throw new Error("lost response"); } };
  await assert.rejects(() => review.service.start({ requestText: "review", repositoryPath: "/repo" }));
  const changed = { ...target, headSha: sha("e") };
  review.setClassification({ decision: { kind: "review", scope: "settled", requirements: "compatible", requestedHead: sha("e"), reasons: [{ code: "requested", evidence: "changed" }] }, reviewTarget: changed });
  await assert.rejects(() => review.service.start({ requestText: "review", repositoryPath: "/repo" }), /Planning retry does not match the immutable record/); assert.equal(review.writes, 1);
});

test("review-only and disputed bugs create no planner/provider mutation", async () => {
  const review = harness({ decision: { kind: "review", scope: "settled", requirements: "compatible", requestedHead: sha("f"), reasons: [{ code: "requested", evidence: "exact head" }] }, reviewTarget: { number: 1, url: "https://github.com/visualjc/shipyard/pull/1", headSha: sha("f"), baseBranch: "main", owner: "visualjc", name: "shipyard" } });
  const reviewStatus = await review.service.start({ requestText: "review", repositoryPath: "/repo" });
  assert.equal(reviewStatus.lane, "review-only"); assert.equal(review.calls, 0); assert.equal(review.writes, 2);
  const bug = harness({ kind: "bug", scope: "settled", requirements: "conflicting", regression: "unproven", reasons: [{ code: "conflict", evidence: "requirements disagree" }] });
  const bugStatus = await bug.service.start({ requestText: "bug", repositoryPath: "/repo" });
  assert.equal(bugStatus.phase, "awaiting-clarification"); assert.equal(bug.calls, 0); assert.equal(bug.writes, 1);
});

test("a valid dependency blocker returns its dependency remediation without classifying or writing", async () => {
  const h = harness({ kind: "feature", scope: "settled", requirements: "compatible", reasons: [{ code: "ok", evidence: "bounded" }] });
  h.setDrift("dependencies");
  const status = await h.service.start({ requestText: "blocked", repositoryPath: "/repo" });
  assert.equal(status.nextSafeCommand, "shipyard-setup");
  assert.equal(status.lane, "unclassified");
  assert.equal(status.phase, "dependency-blocked");
  assert.equal(status.provider, undefined); assert.equal(status.reviewTarget, undefined);
  assert.equal(h.classifications, 0); assert.equal(h.calls, 0); assert.equal(h.reviewCalls, 0); assert.equal(h.ledgerCalls, 0); assert.equal(h.writes, 0);
});

test("unrelated ledger movement after classification blocks planning before the immutable base write", async () => {
  let h: ReturnType<typeof harness>;
  h = harness(() => { h.advanceLedger(); return { kind: "feature", scope: "settled", requirements: "compatible", reasons: [{ code: "settled", evidence: "bounded" }] }; });
  await assert.rejects(() => h.service.start({ requestText: "add", repositoryPath: "/repo" }), /Planning authority changed before dispatch/);
  assert.equal(h.calls, 0); assert.equal(h.writes, 0);
});

test("review is observed twice at its exact bound target and resume returns the durable target", async () => {
  const h = harness({ decision: { kind: "review", scope: "settled", requirements: "compatible", requestedHead: sha("f"), reasons: [{ code: "requested", evidence: "exact" }] }, reviewTarget: { number: 1, url: "https://github.com/visualjc/shipyard/pull/1", headSha: sha("f"), baseBranch: "main", owner: "visualjc", name: "shipyard" } });
  const started = await h.service.start({ requestText: "review", repositoryPath: "/repo" }); assert.equal(h.reviewCalls, 2); assert.equal(started.reviewTarget?.headSha, sha("f"));
  const resumed = await h.service.resume({ repositoryPath: "/repo", deliveryId: started.recordId }); assert.equal(resumed.reviewTarget?.url, "https://github.com/visualjc/shipyard/pull/1"); assert.equal(resumed.ledgerSha, started.ledgerSha);
});

test("invalid review target is rejected before its base ledger record or observer", async () => {
  const valid = { number: 1, url: "https://github.com/visualjc/shipyard/pull/1", headSha: sha("f"), baseBranch: "main", owner: "visualjc", name: "shipyard" };
  for (const target of [{ ...valid, owner: "other", url: "https://github.com/other/shipyard/pull/1" }, { ...valid, baseBranch: "other" }, { ...valid, url: "https://github.com/visualjc/shipyard/pull/2" }, { ...valid, headSha: "f".repeat(41) }]) {
    const h = harness({ decision: { kind: "review", scope: "settled", requirements: "compatible", requestedHead: target.headSha, reasons: [{ code: "requested", evidence: "exact" }] }, reviewTarget: target });
    await assert.rejects(() => h.service.start({ requestText: "review", repositoryPath: "/repo" })); assert.equal(h.writes, 0); assert.equal(h.reviewCalls, 0);
  }
});

test("proven bug records diagnosed and returns a checkpoint-bound resume command", async () => {
  const h = harness({ kind: "bug", scope: "settled", requirements: "compatible", regression: "proven", reasons: [{ code: "proof", evidence: "reproduction" }] });
  const started = await h.service.start({ requestText: "bug", repositoryPath: "/repo" }); assert.equal(started.phase, "diagnosed"); assert.equal(started.nextSafeCommand, `shipyard resume ${started.recordId}`);
  const resumed = await h.service.resume({ repositoryPath: "/repo", deliveryId: started.recordId }); assert.equal(resumed.phase, "diagnosed"); assert.equal(resumed.nextSafeCommand, `shipyard resume ${started.recordId}`);
});

test("classifier and provider failures are redacted at the public service boundary", async () => {
  const classifier = harness(() => { throw new Error("/private/token=secret"); });
  await assert.rejects(() => classifier.service.start({ requestText: "x", repositoryPath: "/repo" }), error => error instanceof Error && error.message === "Planning classification could not be completed.");
  const provider = harness({ kind: "feature", scope: "settled", requirements: "compatible", reasons: [{ code: "ok", evidence: "ok" }] });
  // The planner boundary itself is separately hostile-input tested; this service assertion guards its public diagnostic.
  (provider as any).service["codex"] = { matt: { async plan() { throw new Error("/private/token=secret"); } }, ccpm: { async synthesize() { throw new Error("never"); } } };
  await assert.rejects(() => provider.service.start({ requestText: "x", repositoryPath: "/repo" }), error => error instanceof Error && error.message === "Planning provider could not be completed.");
});

test("table-driven authority drift stops dispatch at classifier and Matt boundaries", async () => {
  const decision = { kind: "feature", scope: "settled", requirements: "compatible", reasons: [{ code: "ok", evidence: "ok" }] };
  for (const kind of ["ledger", "dependencies", "commonDirectory", "objectFormat"] as const) {
    let afterClassifier: ReturnType<typeof harness>; afterClassifier = harness(() => { afterClassifier.setDrift(kind); return decision; });
    await assert.rejects(() => afterClassifier.service.start({ requestText: "x", repositoryPath: "/repo" }), /Planning authority changed before dispatch/); assert.equal(afterClassifier.calls, 0); assert.equal(afterClassifier.writes, 0);
    let afterMatt: ReturnType<typeof harness>; afterMatt = harness(decision, { matt: () => afterMatt.setDrift(kind) });
    await assert.rejects(() => afterMatt.service.start({ requestText: "x", repositoryPath: "/repo" }), /Planning provider could not be completed/); assert.equal(afterMatt.calls, 1); assert.equal(afterMatt.writes, 1);
  }
});

test("table-driven authority drift stops before a provider child checkpoint after CCPM", async () => {
  const large = { kind: "feature", scope: "foggy", requirements: "compatible", reasons: [{ code: "fog", evidence: "unknown" }] };
  const drifts = ["ledger", "dependencies", "commonDirectory", "objectFormat"] as const;
  for (const [index, kind] of drifts.entries()) {
    let h: ReturnType<typeof harness>; h = harness(large, { ccpm: () => { assert.equal(h.calls, 2, "the CCPM hook runs only after Matt and CCPM dispatch"); h.setDrift(kind); } });
    // Keep test identifiers neutral: the harness privacy assertion intentionally scans envelopes for control-plane words.
    await assert.rejects(() => h.service.start({ requestText: "x", repositoryPath: "/repo" }), /Planning provider could not be completed/);
    assert.equal(h.calls, 2); assert.equal(h.writes, 1);
  }
});

test("table-driven review drift between observations prevents a review child checkpoint", async () => {
  const decision = { kind: "review", scope: "settled", requirements: "compatible", requestedHead: sha("f"), reasons: [{ code: "requested", evidence: "exact" }] }, target = { number: 1, url: "https://github.com/visualjc/shipyard/pull/1", headSha: sha("f"), baseBranch: "main", owner: "visualjc", name: "shipyard" };
  for (const kind of ["ledger", "dependencies", "commonDirectory", "objectFormat"] as const) {
    let h: ReturnType<typeof harness>; h = harness({ decision, reviewTarget: target }, { review: () => { if (h.reviewCalls === 1) h.setDrift(kind); } });
    await assert.rejects(() => h.service.start({ requestText: "review", repositoryPath: "/repo" }), /Planning authority changed before dispatch/);
    assert.equal(h.reviewCalls, 1); assert.equal(h.writes, 1);
  }
});

test("post-second-review-observation authority drift prevents the review child write", async () => {
  const decision = { kind: "review", scope: "settled", requirements: "compatible", requestedHead: sha("f"), reasons: [{ code: "requested", evidence: "exact" }] }, target = { number: 1, url: "https://github.com/visualjc/shipyard/pull/1", headSha: sha("f"), baseBranch: "main", owner: "visualjc", name: "shipyard" };
  for (const kind of ["ledger", "dependencies", "commonDirectory", "objectFormat"] as const) { let h: ReturnType<typeof harness>; h = harness({ decision, reviewTarget: target }, { review: () => { if (h.reviewCalls === 2) h.setDrift(kind); } }); await assert.rejects(() => h.service.start({ requestText: "review", repositoryPath: "/repo" }), /Planning authority changed before dispatch/); assert.equal(h.reviewCalls, 2); assert.equal(h.writes, 1); }
});

test("resume rejects every authority drift injected immediately after its ledger read", async () => {
  const decision = { kind: "bug", scope: "settled", requirements: "conflicting", regression: "unproven", reasons: [{ code: "conflict", evidence: "requirements" }] };
  for (const kind of ["ledger", "dependencies", "commonDirectory", "objectFormat"] as const) {
    const h = harness(decision); const started = await h.service.start({ requestText: "bug", repositoryPath: "/repo" });
    const ledger = (h.service as any)["ledger"], read = ledger.read.bind(ledger); ledger.read = async (...args: unknown[]) => { const found = await read(...args); h.setDrift(kind); return found; };
    await assert.rejects(() => h.service.resume({ repositoryPath: "/repo", deliveryId: started.recordId }), /Planning authority changed before dispatch/);
  }
});
