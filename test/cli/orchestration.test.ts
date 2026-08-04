import assert from "node:assert/strict";
import test from "node:test";
import { run } from "../../src/cli/main.js";
import { createRuntime } from "../../src/cli/runtime.js";

const repo = "/safe/repository";
function runtime() {
  const base = createRuntime("/safe/home");
  const calls: unknown[] = [];
  return {
    calls,
    runtime: {
      ...base,
      operations: {
        orchestrate: {
          async start(input: unknown) { calls.push(["start", input]); return status("planned"); },
          async resume(input: unknown) { calls.push(["resume", input]); return status("planned"); },
        },
        review: { async review(input: unknown) { calls.push(["review", input]); return { phase: "reviewed" }; } },
        promote: { async promote(input: unknown) { calls.push(["promote", input]); return { phase: "promoting" }; } },
        finalize: { async finalize(input: unknown) { calls.push(["finalize", input]); return { phase: "complete" }; } },
      },
    },
  };
}
function status(phase: "planned") { return { recordId: "delivery-1", lane: "small" as const, phase, productSha: "a".repeat(40), ledgerSha: "b".repeat(40), blockers: [], nextSafeCommand: "shipyard" }; }

test("public commands dispatch only an opaque natural-language request or bounded delivery identifiers", async () => {
  const fixture = runtime();
  const start = await run(["A", "settled", "small", "change"], "shipyard", repo, fixture.runtime);
  assert.equal(start.code, 0, start.output);
  assert.deepEqual(fixture.calls, [["start", { repositoryPath: repo, requestText: "A settled small change" }]]);
  const resume = await run(["resume", "delivery-1"], "shipyard", repo, fixture.runtime);
  assert.equal(resume.code, 0, resume.output);
  const review = await run(["--delivery-id", "delivery-1", "--repo", repo], "review", repo, fixture.runtime);
  const promote = await run(["--delivery-id", "delivery-1", "--action", "certify", "--repo", repo], "promote", repo, fixture.runtime);
  const finalize = await run(["--delivery-id", "delivery-1", "--repo", repo], "finalize", repo, fixture.runtime);
  assert.equal(review.code, 0); assert.equal(promote.code, 0); assert.equal(finalize.code, 0);
  assert.deepEqual(fixture.calls.slice(1), [
    ["resume", { repositoryPath: repo, deliveryId: "delivery-1" }],
    ["review", { deliveryId: "delivery-1" }],
    ["promote", { deliveryId: "delivery-1", action: "certify" }],
    ["finalize", { deliveryId: "delivery-1" }],
  ]);
});

test("mutation command argument matrices reject ambiguity before runtime composition", async () => {
  for (const [command, argv] of [
    ["shipyard", ["a", "request", "--repo", "/elsewhere"]],
    ["review", ["--delivery-id", "one", "--provider", "github"]],
    ["promote", ["--delivery-id", "one", "--action", "initial", "--actor", "other"]],
    ["finalize", ["--delivery-id", "one", "extra"]],
    ["setup", ["--profile", "p", "--bogus"]],
    ["status", ["--lane", "large", "--lane", "small"]],
    ["status", ["unexpected"]],
  ] as const) {
    const result = await run(argv, command as Parameters<typeof run>[1], "/not/a/repository");
    assert.equal(result.code, 1);
    assert.match(result.output, /rejects (unknown|duplicate|unexpected|ambiguous)/i);
  }
});

test("unconfigured release facades fail closed and planning requires a bound repository", async () => {
  for (const [command, argv] of [
    ["review", ["--delivery-id", "delivery-1"]],
    ["promote", ["--delivery-id", "delivery-1", "--action", "initial"]],
    ["finalize", ["--delivery-id", "delivery-1"]],
  ] as const) {
    const result = await run(argv, command as Parameters<typeof run>[1], repo);
    assert.equal(result.code, 1);
    assert.match(result.output, /not configured/i);
  }
  const planning = await run(["work"], "shipyard", repo);
  assert.equal(planning.code, 1);
  assert.match(planning.output, /not a Git repository/i);
});
