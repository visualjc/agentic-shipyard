import assert from "node:assert/strict";
import test from "node:test";
import { stableShipyardMarker } from "../../src/github/markers.js";
import { trackDevelopmentRecords } from "../../src/github/tracker.js";
import type { Topology } from "../../src/contracts/types.js";
import { FakeVerifiedGitHubSession } from "../helpers/github.js";

const development = { owner: "acme", name: "development", remote: { name: "origin", url: "https://github.com/acme/development.git" }, defaultBranch: "main" };
const destination = { owner: "acme", name: "destination", remote: { name: "origin", url: "https://github.com/acme/destination.git" }, defaultBranch: "main" };
const staged: Topology = { kind: "staged-pair", development, destination };
const single: Topology = { kind: "single-repository", repository: development };
const request = { deliveryId: "delivery-42", issue: { title: "Implement widget", body: "Work item" }, pullRequest: { title: "Implement widget", body: "Ready for review", head: "shipyard/delivery-42", base: "main", expectedHeadSha: "a".repeat(40) } };

test("uses a stable marker and creates the staged-pair issue and PR only in development", async () => {
  const marker = stableShipyardMarker(request.deliveryId);
  const session = new FakeVerifiedGitHubSession("shipyard-actor", async rest => {
    if (rest.method === "GET") return [];
    if (rest.path.endsWith("/issues")) return { id: "I_1", number: 17, html_url: "https://github.test/acme/development/issues/17" };
    return { id: "PR_1", number: 23, html_url: "https://github.test/acme/development/pull/23", head: { sha: request.pullRequest.expectedHeadSha } };
  });

  const checkpoint = await trackDevelopmentRecords(session, staged, request);

  assert.deepEqual(session.requests.map(call => call.path), ["/repos/acme/development/issues?state=all", "/repos/acme/development/pulls?state=all"]);
  assert.deepEqual(session.writes.map(call => call.path), ["/repos/acme/development/issues", "/repos/acme/development/pulls"]);
  assert.ok(session.writes.every(call => call.path.includes("/acme/development/")));
  assert.equal((session.writes[0].body as { body: string }).body, `Work item\n\n${marker}`);
  assert.equal((session.writes[1].body as { body: string }).body, `Ready for review\n\n${marker}`);
  assert.deepEqual(checkpoint, { marker, actorLogin: "shipyard-actor", issue: { state: "created", id: "I_1", number: 17, url: "https://github.test/acme/development/issues/17" }, pullRequest: { state: "created", id: "PR_1", number: 23, url: "https://github.test/acme/development/pull/23", expectedHeadSha: request.pullRequest.expectedHeadSha } });
});

test("discovers exact marked records without duplicate writes", async () => {
  const marker = stableShipyardMarker(request.deliveryId);
  const session = new FakeVerifiedGitHubSession("shipyard-actor", async rest => rest.path.endsWith("/issues?state=all")
    ? [{ id: "I_1", number: 17, html_url: "https://github.test/acme/development/issues/17", body: `details\n${marker}` }]
    : [{ id: "PR_1", number: 23, html_url: "https://github.test/acme/development/pull/23", body: marker, head: { sha: request.pullRequest.expectedHeadSha } }]);

  const checkpoint = await trackDevelopmentRecords(session, single, request);

  assert.equal(session.writes.length, 0);
  assert.equal(checkpoint.issue.state, "discovered");
  assert.equal(checkpoint.pullRequest.state, "discovered");
  assert.equal(checkpoint.pullRequest.expectedHeadSha, request.pullRequest.expectedHeadSha);
});

test("issue discovery ignores marked pull requests and requires an exact standalone marker line", async () => {
  const marker = stableShipyardMarker(request.deliveryId);
  const session = new FakeVerifiedGitHubSession("shipyard-actor", async rest => {
    if (rest.path.endsWith("/issues?state=all")) return [
      { id: 91, node_id: "I_real", number: 91, html_url: "https://github.test/issues/91", body: marker, pull_request: { url: "https://github.test/pulls/91" } },
      { id: 17, node_id: "I_real_issue", number: 17, html_url: "https://github.test/issues/17", body: `details\n${marker}\n` },
      { id: 18, node_id: "I_substring", number: 18, html_url: "https://github.test/issues/18", body: `not-${marker}-not` },
    ];
    return [{ id: 23, node_id: "PR_real", number: 23, html_url: "https://github.test/pull/23", body: marker, head: { sha: request.pullRequest.expectedHeadSha } }];
  });

  const checkpoint = await trackDevelopmentRecords(session, single, { ...request, resume: { issueId: "I_real_issue", pullRequestId: "PR_real" } });

  assert.equal(session.writes.length, 0);
  assert.equal(checkpoint.issue.id, "I_real_issue");
  assert.equal(checkpoint.pullRequest.id, "PR_real");
});

test("blocks ambiguous or mismatched records before any write", async t => {
  const marker = stableShipyardMarker(request.deliveryId);
  await t.test("ambiguous issue", async () => {
    const session = new FakeVerifiedGitHubSession("shipyard-actor", async () => [
      { id: "I_1", number: 1, html_url: "https://github.test/issues/1", body: marker },
      { id: "I_2", number: 2, html_url: "https://github.test/issues/2", body: marker },
    ]);
    await assert.rejects(trackDevelopmentRecords(session, staged, request), { code: "ambiguous-record" });
    assert.equal(session.writes.length, 0);
  });
  await t.test("PR head differs from the requested SHA", async () => {
    const session = new FakeVerifiedGitHubSession("shipyard-actor", async rest => rest.path.endsWith("/issues?state=all")
      ? [{ id: "I_1", number: 1, html_url: "https://github.test/issues/1", body: marker }]
      : [{ id: "PR_1", number: 2, html_url: "https://github.test/pull/2", body: marker, head: { sha: "b".repeat(40) } }]);
    await assert.rejects(trackDevelopmentRecords(session, staged, request), { code: "head-sha-mismatch" });
    assert.equal(session.writes.length, 0);
  });
  await t.test("checkpointed provider ID differs from the marked record", async () => {
    const session = new FakeVerifiedGitHubSession("shipyard-actor", async () => [
      { id: "I_replaced", number: 1, html_url: "https://github.test/issues/1", body: marker },
    ]);
    await assert.rejects(trackDevelopmentRecords(session, staged, { ...request, resume: { issueId: "I_original" } }), { code: "resume-mismatch" });
    assert.equal(session.writes.length, 0);
  });
  await t.test("requested expected SHA is not an exact commit SHA", async () => {
    const session = new FakeVerifiedGitHubSession("shipyard-actor", async () => []);
    await assert.rejects(trackDevelopmentRecords(session, staged, { ...request, pullRequest: { ...request.pullRequest, expectedHeadSha: "short" } }), { code: "invalid-head-sha" });
    assert.equal(session.requests.length, 0);
    assert.equal(session.writes.length, 0);
  });
});
