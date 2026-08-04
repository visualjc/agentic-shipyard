import assert from "node:assert/strict";
import test from "node:test";
import { createStatusProjection, composeStatus } from "../../src/status/projection.js";
import { githubTrackerStatusContributor } from "../../src/github/status.js";

test("contributes verified actor, record facts, and a safe no-write next action", () => {
  const base = createStatusProjection({ phase: "implementing", nextSafeAction: "shipyard" });
  const status = composeStatus(base, [githubTrackerStatusContributor({
    actorLogin: "shipyard-actor",
    permission: "verified",
    checkpoint: {
      marker: "<!-- shipyard:development-record:v1:delivery-42 -->",
      actorLogin: "shipyard-actor",
      issue: { state: "discovered", id: "I_1", number: 17, url: "https://github.test/acme/development/issues/17" },
      pullRequest: { state: "created", id: "PR_1", number: 23, url: "https://github.test/acme/development/pull/23", expectedHeadSha: "a".repeat(40) },
    },
  })]);

  assert.deepEqual(status.providerRefs, {
    githubActor: "shipyard-actor",
    githubPermission: "verified",
    developmentIssue: "https://github.test/acme/development/issues/17",
    developmentIssueId: "I_1",
    developmentPullRequest: "https://github.test/acme/development/pull/23",
    developmentPullRequestId: "PR_1",
    developmentPullRequestExpectedHeadSha: "a".repeat(40),
    developmentRecordMarker: "<!-- shipyard:development-record:v1:delivery-42 -->",
  });
  assert.equal(status.nextSafeAction, "shipyard-status");
  assert.deepEqual(status.blockers, []);
});

test("contributes a provider blocker without performing a write", () => {
  const base = createStatusProjection({ phase: "blocked", nextSafeAction: "shipyard" });
  const status = composeStatus(base, [githubTrackerStatusContributor({
    actorLogin: "shipyard-actor",
    permission: "blocked",
    blocker: { code: "head-sha-mismatch", message: "The PR head is no longer the requested SHA." },
  })]);

  assert.equal(status.providerRefs?.githubActor, "shipyard-actor");
  assert.equal(status.providerRefs?.githubPermission, "blocked");
  assert.equal(status.nextSafeAction, "Resolve the GitHub tracker blocker before retrying.");
  assert.deepEqual(status.blockers, [{ code: "head-sha-mismatch", message: "The PR head is no longer the requested SHA." }]);
});
