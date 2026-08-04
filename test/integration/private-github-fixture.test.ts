import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FetchGitHubRestTransport, GitHubRestAdapter } from "../../src/adapters/github-rest.js";
import { trackDevelopmentRecords } from "../../src/github/tracker.js";
import { DevelopmentRecordGuard } from "../../src/github/tracking-guard.js";
import { MutationLockService } from "../../src/locking/mutation-lock.js";
import { nodeFilesystem } from "../../src/adapters/filesystem.js";
import { nodeProcess } from "../../src/adapters/process.js";
import { canonicalWorkspaceBranch, stableDeliveryId } from "../../src/delivery/registry.js";
import { GitHubAuthorityError } from "../../src/github/errors.js";
import type { GitHubApiCredential, GitHubRestClientFactory, GitHubRestRequest } from "../../src/github/types.js";

const enabled = process.env.SHIPYARD_PRIVATE_GITHUB_FIXTURE === "1";
const acknowledgement = "I_ACKNOWLEDGE_DISPOSABLE_GITHUB_MUTATIONS";

test("private fixture creates then idempotently discovers one approved development issue and PR", { skip: !enabled }, async () => {
  const repository = required("SHIPYARD_PRIVATE_GITHUB_REPOSITORY");
  const approvedRepository = required("SHIPYARD_PRIVATE_GITHUB_APPROVED_REPOSITORY");
  assert.equal(repository, approvedRepository, "fixture repository must exactly equal the separately approved disposable repository");
  assert.equal(required("SHIPYARD_PRIVATE_GITHUB_MUTATION_ACKNOWLEDGEMENT"), acknowledgement);
  const { owner, name } = fixtureRepository(repository);
  const head = required("SHIPYARD_PRIVATE_GITHUB_HEAD_REF");
  const deliveryId = deliveryIdFromFixtureHead(head);
  const actor = required("SHIPYARD_PRIVATE_GITHUB_ACTOR");
  const token = required("SHIPYARD_PRIVATE_GITHUB_TOKEN");
  const base = required("SHIPYARD_PRIVATE_GITHUB_BASE_REF");
  const sha = required("SHIPYARD_PRIVATE_GITHUB_HEAD_SHA");
  assert.match(base, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/); assert.ok(!base.includes(":") && !base.includes(".."));
  assert.match(sha, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
  const root = await mkdtemp(join(tmpdir(), "shipyard-private-tracker-"));
  const credential = Object.freeze({ authorizationValue: token });
  const api = new GitHubRestAdapter({ resolve: async () => credential }, new FetchGitHubRestTransport());
  const topology = { kind: "single-repository" as const, repository: { owner, name, remote: { name: "origin", url: `https://github.com/${repository}.git` }, defaultBranch: base } };
  const bound = { resolve: async () => ({ profileName: "private-fixture", commonDirectory: root, profileFingerprint: "0".repeat(64), actorLogin: actor, topology }) };
  const authority = {
    repositoryPath: root,
    guard: new DevelopmentRecordGuard(new MutationLockService(nodeFilesystem, nodeProcess), bound),
    trackingAuthority: { resolve: async () => ({ commonDirectory: root, actorLogin: actor, repository: topology.repository, head, base, expectedHeadSha: sha }) },
    credentials: { resolve: async () => credential }, client: api,
  };
  const request = { deliveryId, issue: { title: "Shipyard disposable tracker fixture", body: "Approved disposable tracker run." }, pullRequest: { title: "Shipyard disposable tracker fixture", body: "Approved disposable tracker run." } };
  let issue: number | undefined; let pullRequest: number | undefined;
  try {
    const first = await trackDevelopmentRecords(authority, request);
    issue = first.issue.number; pullRequest = first.pullRequest.number;
    assert.equal(first.issue.state, "created"); assert.equal(first.pullRequest.state, "created");
    assert.match(first.issue.url, new RegExp(`/${repository}/issues/${issue}$`));
    assert.match(first.pullRequest.url, new RegExp(`/${repository}/pull/${pullRequest}$`));
    assert.equal(first.pullRequest.expectedHeadSha, sha);
    const second = await trackDevelopmentRecords(authority, request);
    assert.equal(second.issue.state, "discovered"); assert.equal(second.pullRequest.state, "discovered");
    assert.equal(second.issue.id, first.issue.id); assert.equal(second.pullRequest.id, first.pullRequest.id);
  } finally {
    try {
      if (issue !== undefined || pullRequest !== undefined) await closePrivateFixtureRecords(actor, repository, approvedRepository, credential, api, { issue, pullRequest });
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("private fixture derives one canonical delivery identity from its approved head before provider use", () => {
  assert.equal(deliveryIdFromFixtureHead("shipyard/fixture-123"), "fixture-123");
  let providerCalls = 0;
  for (const head of ["feature/fixture-123", "shipyard/Fixture-123", `shipyard/${"a".repeat(65)}`, "shipyard/delivery..123", "shipyard/delivery/123", "shipyard/"]) {
    assert.throws(() => {
      const deliveryId = deliveryIdFromFixtureHead(head);
      providerCalls += 1;
      return deliveryId;
    });
  }
  assert.equal(providerCalls, 0);
});

test("private fixture cleanup verifies one actor-bound client and permits only exact approved close requests", async () => {
  const credential = Object.freeze({ authorizationValue: "test-token" });
  const requests: GitHubRestRequest[] = []; let factoryCalls = 0;
  const client: GitHubRestClientFactory = { forCredential(actual) {
    factoryCalls += 1; assert.equal(actual, credential);
    return { request: async <T>(request: GitHubRestRequest) => {
      requests.push(request);
      return (request.path === "/user" ? { login: "fixture-actor" } : {}) as T;
    } };
  } };
  await closePrivateFixtureRecords("fixture-actor", "acme/disposable", "acme/disposable", credential, client, { issue: 17, pullRequest: 23 });
  assert.equal(factoryCalls, 1);
  assert.deepEqual(requests, [
    { method: "GET", path: "/user" },
    { method: "PATCH", path: "/repos/acme/disposable/pulls/23", body: { state: "closed" } },
    { method: "PATCH", path: "/repos/acme/disposable/issues/17", body: { state: "closed" } },
  ]);

  const wrongActorRequests: GitHubRestRequest[] = [];
  const wrongActor: GitHubRestClientFactory = { forCredential: () => ({ request: async <T>(request: GitHubRestRequest) => {
    wrongActorRequests.push(request); return { login: "someone-else" } as T;
  } }) };
  await assert.rejects(closePrivateFixtureRecords("fixture-actor", "acme/disposable", "acme/disposable", credential, wrongActor, { issue: 17, pullRequest: 23 }), (error: unknown) => error instanceof GitHubAuthorityError && error.code === "actor-mismatch");
  assert.deepEqual(wrongActorRequests, [{ method: "GET", path: "/user" }]);

  let outOfScopeFactoryCalls = 0;
  const outOfScope: GitHubRestClientFactory = { forCredential: () => { outOfScopeFactoryCalls += 1; throw new Error("must not bind an out-of-scope cleanup client"); } };
  await assert.rejects(closePrivateFixtureRecords("fixture-actor", "acme/other", "acme/disposable", credential, outOfScope, { issue: 17 }));
  await assert.rejects(closePrivateFixtureRecords("fixture-actor", "acme/disposable", "acme/disposable", credential, outOfScope, { issue: -1 }));
  assert.equal(outOfScopeFactoryCalls, 0);
});

function deliveryIdFromFixtureHead(head: string): string {
  const prefix = "shipyard/";
  assert.ok(head.startsWith(prefix), "fixture head must be the canonical branch for its delivery ID");
  const deliveryId = stableDeliveryId(head.slice(prefix.length));
  canonicalWorkspaceBranch(head, deliveryId);
  return deliveryId;
}

async function closePrivateFixtureRecords(
  expectedActor: string,
  repository: string,
  separatelyApprovedRepository: string,
  credential: GitHubApiCredential,
  factory: GitHubRestClientFactory,
  records: Readonly<{ issue?: number; pullRequest?: number }>,
): Promise<void> {
  assert.equal(repository, separatelyApprovedRepository, "fixture cleanup repository must exactly equal the separately approved disposable repository");
  const { basePath } = fixtureRepository(repository);
  const issue = fixtureRecordNumber(records.issue); const pullRequest = fixtureRecordNumber(records.pullRequest);
  assert.ok(issue !== undefined || pullRequest !== undefined, "fixture cleanup requires a created issue or pull request");
  const client = factory.forCredential(credential);
  const viewer = await client.request<{ login?: unknown }>({ method: "GET", path: "/user" });
  if (viewer.login !== expectedActor) throw new GitHubAuthorityError("actor-mismatch", "GitHub authenticated actor does not match the configured fixture actor.");
  if (pullRequest !== undefined) await client.request({ method: "PATCH", path: `${basePath}/pulls/${pullRequest}`, body: { state: "closed" } });
  if (issue !== undefined) await client.request({ method: "PATCH", path: `${basePath}/issues/${issue}`, body: { state: "closed" } });
}

function fixtureRepository(repository: string): { owner: string; name: string; basePath: string } {
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  const [owner, name] = repository.split("/");
  assert.ok(owner !== "." && owner !== ".." && name !== "." && name !== ".." && !owner.includes("..") && !name.includes(".."));
  assert.notEqual(owner.toLowerCase(), "nativeinteractive");
  return { owner, name, basePath: `/repos/${owner}/${name}` };
}

function fixtureRecordNumber(value: number | undefined): number | undefined {
  if (value !== undefined) assert.ok(Number.isSafeInteger(value) && value > 0, "fixture cleanup record number must be a positive safe integer");
  return value;
}

function required(name: string): string { const value = process.env[name]; assert.ok(value, `${name} is required`); return value!; }
