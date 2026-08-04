import assert from "node:assert/strict";
import test from "node:test";
import { GitHubSingleRepositoryProviderAuthority } from "../../src/adapters/single-repository-pr.js";
import type { GitHubRestRequest } from "../../src/github/types.js";
import { stableShipyardMarker } from "../../src/github/markers.js";
import { dossierDigest } from "../../src/single-repository/dossier.js";

const head = "a".repeat(40), baseSha = "b".repeat(40), repository = { owner: "acme", name: "product", remote: { name: "origin", url: "https://github.com/acme/product.git" }, defaultBranch: "main" };
function repo(owner = "acme", name = "product") { return { name, full_name: `${owner}/${name}`, owner: { login: owner } }; }
function pull(overrides: Record<string, unknown> = {}) { return { node_id: "PR_one", number: 8, html_url: "https://github.com/acme/product/pull/8", body: `Work\n\n${stableShipyardMarker("delivery")}`, state: "open", draft: true, merged: false, head: { ref: "shipyard/delivery", sha: head, repo: repo() }, base: { ref: "main", sha: baseSha, repo: repo() }, pull_request: {}, ...overrides }; }
function issue(state = "open") { return { node_id: "I_one", number: 7, html_url: "https://github.com/acme/product/issues/7", body: stableShipyardMarker("delivery"), state }; }
class Api {
  readonly calls: GitHubRestRequest[] = []; currentPull = pull(); currentPulls: unknown[] | undefined; currentIssue = issue(); losePatch = true; loseReady = true;
  constructor(readonly actor = "actor") {}
  async request<T>(call: GitHubRestRequest): Promise<T> { this.calls.push(structuredClone(call)); let result: unknown;
    if (call.path === "/user") result = { login: this.actor };
    else if (call.path === "/repos/acme/product/pulls?state=all&per_page=100&page=1") result = this.currentPulls ?? [this.currentPull];
    else if (call.path === "/repos/acme/product/issues?state=all&per_page=100&page=1") result = [this.currentIssue, this.currentPull];
    else if (call.path === "/repos/acme/product/pulls/8" && call.method === "GET") result = this.currentPull;
    else if (call.path === "/repos/acme/product/pulls/8" && call.method === "PATCH") { this.currentPull = { ...this.currentPull, body: String((call.body as { body: string }).body) }; if (this.losePatch) { this.losePatch = false; throw new Error("response lost"); } result = this.currentPull; }
    else if (call.path === "/repos/acme/product/pulls/8/ready_for_review" && call.method === "POST") { this.currentPull = { ...this.currentPull, draft: false }; if (this.loseReady) { this.loseReady = false; throw new Error("response lost"); } result = this.currentPull; }
    else if (call.path === "/repos/acme/product/issues/7" && call.method === "GET") result = this.currentIssue;
    else if (call.path === "/repos/acme/product/issues/7" && call.method === "PATCH") { this.currentIssue = issue("closed"); result = this.currentIssue; }
    else throw new Error(`unexpected ${call.method} ${call.path}`); return result as T;
  }
  authority() { return new GitHubSingleRepositoryProviderAuthority({ resolve: async () => ({ authorizationValue: "Bearer secret-never-log" }) }, { forCredential: () => this }); }
}

test("updates and readies the one marked same-repository PR idempotently without a create or merge capability", async () => {
  const api = new Api(), session = await api.authority().open({ actorLogin: "actor", repository }), observed = await session.observeExistingPullRequest({ deliveryId: "delivery" }), dossier = "## Exact review\n\nReviewed head is exact.";
  await assert.rejects(session.updateReviewDossier({ expected: observed, dossier }), /response lost/); const afterDossier = await session.updateReviewDossier({ expected: observed, dossier }); assert.equal(afterDossier.dossierDigest, dossierDigest(dossier)); assert.equal(api.calls.filter((call) => call.method === "PATCH" && call.path.includes("/pulls/")).length, 1);
  await assert.rejects(session.markReady({ expected: afterDossier, dossierDigest: dossierDigest(dossier) }), /response lost/); const ready = await session.markReady({ expected: afterDossier, dossierDigest: dossierDigest(dossier) }); assert.equal(ready.draft, false); assert.equal(api.calls.filter((call) => call.path.endsWith("ready_for_review")).length, 1);
  const tracked = await session.observeTrackedIssue("delivery"); assert.ok(tracked); await session.closeTrackedIssue(tracked!); assert.equal(api.currentIssue.state, "closed");
  assert.ok(!("createPullRequest" in session)); assert.ok(!("mergePullRequest" in session)); assert.ok(!("createIssue" in session)); assert.ok(!api.calls.some((call) => call.path === "/repos/acme/product/pulls")); assert.doesNotMatch(JSON.stringify(api.calls), /secret-never-log/);
});

test("wrong actor, fork, and replaced checkpoint fail closed while retarget/head changes remain visible to the trusted service", async () => {
  const wrong = new Api("other"); await assert.rejects(wrong.authority().open({ actorLogin: "actor", repository }), /actor authority/i); assert.equal(wrong.calls.filter((call) => call.method !== "GET").length, 0);
  const fork = new Api(); fork.currentPull = pull({ head: { ref: "shipyard/delivery", sha: head, repo: repo("other", "fork") } }); await assert.rejects((await fork.authority().open({ actorLogin: "actor", repository })).observeExistingPullRequest({ deliveryId: "delivery" }), /forked or cross-repository/i);
  const changed = new Api(); changed.currentPull = pull({ base: { ref: "other", sha: baseSha, repo: repo() }, head: { ref: "shipyard/delivery", sha: "c".repeat(40), repo: repo() } }); const observed = await (await changed.authority().open({ actorLogin: "actor", repository })).observeExistingPullRequest({ deliveryId: "delivery" }); assert.equal(observed.baseRef, "other"); assert.equal(observed.headSha, "c".repeat(40));
  const api = new Api(), session = await api.authority().open({ actorLogin: "actor", repository }); await assert.rejects(session.observeExistingPullRequest({ deliveryId: "delivery", resumeNumber: 99 }), /missing or replaced/i);
  const ambiguous = new Api(); ambiguous.currentPulls = [ambiguous.currentPull, pull({ node_id: "PR_two", number: 9, html_url: "https://github.com/acme/product/pull/9" })]; await assert.rejects((await ambiguous.authority().open({ actorLogin: "actor", repository })).observeExistingPullRequest({ deliveryId: "delivery" }), /ambiguous/i); assert.equal(ambiguous.calls.filter((call) => call.method !== "GET").length, 0);
});

test("tracked issue marker removal race fails closed before close", async () => {
  const api = new Api(), session = await api.authority().open({ actorLogin: "actor", repository }), tracked = await session.observeTrackedIssue("delivery"); assert.ok(tracked);
  api.currentIssue = { ...api.currentIssue, body: "marker removed" };
  await assert.rejects(session.closeTrackedIssue(tracked), /identity changed|provider record/i);
  assert.equal(api.calls.filter((call) => call.method === "PATCH" && call.path.endsWith("/issues/7")).length, 0);
});
