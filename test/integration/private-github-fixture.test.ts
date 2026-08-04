import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FetchGitHubRestTransport, GitHubRestAdapter } from "../../src/adapters/github-rest.js";
import { stableShipyardMarker } from "../../src/github/markers.js";
import { trackDevelopmentRecords } from "../../src/github/tracker.js";
import { DevelopmentRecordGuard } from "../../src/github/tracking-guard.js";
import { MutationLockService } from "../../src/locking/mutation-lock.js";
import { nodeFilesystem } from "../../src/adapters/filesystem.js";
import { nodeProcess } from "../../src/adapters/process.js";
import { canonicalWorkspaceBranch, stableDeliveryId } from "../../src/delivery/registry.js";
import { GitHubAuthorityError } from "../../src/github/errors.js";
import type { GitHubApiCredential, GitHubRestClientFactory, GitHubRestRequest } from "../../src/github/types.js";
import type { BoundProfileAuthority, BoundProfileAuthorityResolver } from "../../src/profile/bound-authority.js";
import { FakeProcess, MemoryFilesystem } from "../helpers/fakes.js";

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
  const credential = Object.freeze({ authorizationValue: token });
  const api = new GitHubRestAdapter({ resolve: async () => credential }, new FetchGitHubRestTransport());
  await preflightPrivateFixture(actor, repository, approvedRepository, head, sha, credential, api);
  const root = await mkdtemp(join(tmpdir(), "shipyard-private-tracker-"));
  const topology = { kind: "single-repository" as const, repository: { owner, name, remote: { name: "origin", url: `https://github.com/${repository}.git` }, defaultBranch: base } };
  const bound = { resolve: async () => ({ profileName: "private-fixture", commonDirectory: root, profileFingerprint: "0".repeat(64), actorLogin: actor, topology }) };
  const observedCreates = observePrivateFixtureCreates(repository, approvedRepository, api);
  const guard = new PrewriteFixtureGuard(
    new MutationLockService(nodeFilesystem, nodeProcess),
    bound,
    () => preflightPrivateFixture(actor, repository, approvedRepository, head, sha, credential, api),
  );
  const authority = {
    repositoryPath: root,
    guard,
    trackingAuthority: { resolve: async () => ({ commonDirectory: root, actorLogin: actor, repository: topology.repository, head, base, expectedHeadSha: sha }) },
    credentials: { resolve: async () => credential }, client: observedCreates.factory,
  };
  const request = { deliveryId, issue: { title: "Shipyard disposable tracker fixture", body: "Approved disposable tracker run." }, pullRequest: { title: "Shipyard disposable tracker fixture", body: "Approved disposable tracker run." } };
  try {
    let first: TrackingCheckpoint;
    try { first = await trackDevelopmentRecords(authority, request); }
    finally { observedCreates.stop(); }
    assert.deepEqual(observedCreates.records(), createdFixtureRecordNumbers(first));
    assert.equal(first.issue.state, "created"); assert.equal(first.pullRequest.state, "created");
    assert.match(first.issue.url, new RegExp(`/${repository}/issues/${first.issue.number}$`));
    assert.match(first.pullRequest.url, new RegExp(`/${repository}/pull/${first.pullRequest.number}$`));
    assert.equal(first.pullRequest.expectedHeadSha, sha);
    const second = await trackDevelopmentRecords(authority, request);
    assert.equal(second.issue.state, "discovered"); assert.equal(second.pullRequest.state, "discovered");
    assert.equal(second.issue.id, first.issue.id); assert.equal(second.pullRequest.id, first.pullRequest.id);
  } finally {
    try {
      await closeCreatedPrivateFixtureRecords(actor, repository, approvedRepository, credential, api, observedCreates.records());
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

test("private fixture preflight verifies the exact actor and live encoded head before mutation", async () => {
  const sha = "a".repeat(40); const credential = Object.freeze({ authorizationValue: "test-token" });
  const requests: GitHubRestRequest[] = []; let factoryCalls = 0;
  const client: GitHubRestClientFactory = { forCredential(actual) {
    factoryCalls += 1; assert.equal(actual, credential);
    return { request: async <T>(request: GitHubRestRequest) => {
      requests.push(request);
      if (request.path === "/user") return { login: "fixture-actor" } as T;
      return { name: "shipyard/fixture-123", commit: { sha } } as T;
    } };
  } };
  await preflightPrivateFixture("fixture-actor", "acme/disposable", "acme/disposable", "shipyard/fixture-123", sha, credential, client);
  assert.equal(factoryCalls, 1);
  assert.deepEqual(requests, [
    { method: "GET", path: "/user" },
    { method: "GET", path: "/repos/acme/disposable/branches/shipyard%2Ffixture-123" },
  ]);

  for (const scenario of [
    { name: "wrong actor", viewer: "someone-else", branch: "shipyard/fixture-123", branchSha: sha, expectedGets: 1 },
    { name: "wrong branch", viewer: "fixture-actor", branch: "shipyard/other", branchSha: sha, expectedGets: 2 },
    { name: "wrong SHA", viewer: "fixture-actor", branch: "shipyard/fixture-123", branchSha: "b".repeat(40), expectedGets: 2 },
  ]) {
    const seen: GitHubRestRequest[] = [];
    const mismatch: GitHubRestClientFactory = { forCredential: actual => {
      assert.equal(actual, credential);
      return { request: async <T>(request: GitHubRestRequest) => {
        seen.push(request);
        return (request.path === "/user" ? { login: scenario.viewer } : { name: scenario.branch, commit: { sha: scenario.branchSha } }) as T;
      } };
    } };
    await assert.rejects(preflightPrivateFixture("fixture-actor", "acme/disposable", "acme/disposable", "shipyard/fixture-123", sha, credential, mismatch), GitHubAuthorityError, scenario.name);
    assert.equal(seen.length, scenario.expectedGets);
    assert.ok(seen.every(request => request.method === "GET"), `${scenario.name} must not reach POST or PATCH`);
  }

  const missingRequests: GitHubRestRequest[] = [];
  const missing: GitHubRestClientFactory = { forCredential: () => ({ request: async <T>(request: GitHubRestRequest) => {
    missingRequests.push(request);
    if (request.path === "/user") return { login: "fixture-actor" } as T;
    throw new GitHubAuthorityError("request-failed", "fixture branch was not found");
  } }) };
  await assert.rejects(preflightPrivateFixture("fixture-actor", "acme/disposable", "acme/disposable", "shipyard/fixture-123", sha, credential, missing), (error: unknown) => error instanceof GitHubAuthorityError && error.code === "request-failed");
  assert.ok(missingRequests.every(request => request.method === "GET"));

  let wrongRepositoryBindings = 0;
  const wrongRepository: GitHubRestClientFactory = { forCredential: () => { wrongRepositoryBindings += 1; throw new Error("must not bind for an unapproved repository"); } };
  await assert.rejects(preflightPrivateFixture("fixture-actor", "acme/other", "acme/disposable", "shipyard/fixture-123", sha, credential, wrongRepository));
  assert.equal(wrongRepositoryBindings, 0);
});

test("private fixture never makes discovered-first provider records eligible for cleanup", async () => {
  const actor = "fixture-actor"; const repository = "acme/disposable"; const deliveryId = "fixture-existing";
  const head = `shipyard/${deliveryId}`; const sha = "a".repeat(40); const marker = stableShipyardMarker(deliveryId);
  const credential = Object.freeze({ authorizationValue: "test-token" }); const requests: GitHubRestRequest[] = [];
  const githubRepository = { name: "disposable", full_name: repository, owner: { login: "acme" } };
  const client: GitHubRestClientFactory = { forCredential(actual) {
    assert.equal(actual, credential);
    return { request: async <T>(request: GitHubRestRequest) => {
      requests.push(request);
      if (request.path === "/user") return { login: actor } as T;
      if (request.path.includes("/branches/")) return { name: head, commit: { sha } } as T;
      if (request.path.includes("/issues?")) return [{ id: "I_existing", number: 17, html_url: `https://github.test/${repository}/issues/17`, body: marker }] as T;
      if (request.path.includes("/pulls?")) return [{ id: "PR_existing", number: 23, html_url: `https://github.test/${repository}/pull/23`, body: marker, head: { sha, ref: head, repo: githubRepository }, base: { ref: "main" } }] as T;
      return assert.fail(`discovered-first fixture must not write: ${request.method} ${request.path}`);
    } };
  } };
  await preflightPrivateFixture(actor, repository, repository, head, sha, credential, client);
  const observedCreates = observePrivateFixtureCreates(repository, repository, client);
  const topology = { kind: "single-repository" as const, repository: { owner: "acme", name: "disposable", remote: { name: "origin", url: `https://github.com/${repository}.git` }, defaultBranch: "main" } };
  const bound = { resolve: async () => ({ profileName: "private-fixture", commonDirectory: "/fixture/.git", profileFingerprint: "0".repeat(64), actorLogin: actor, topology }) };
  const guard = new PrewriteFixtureGuard(new MutationLockService(new MemoryFilesystem(), new FakeProcess()), bound, () => preflightPrivateFixture(actor, repository, repository, head, sha, credential, client));
  const first = await trackDevelopmentRecords({
    repositoryPath: "/fixture", guard,
    trackingAuthority: { resolve: async () => ({ commonDirectory: "/fixture/.git", actorLogin: actor, repository: topology.repository, head, base: "main", expectedHeadSha: sha }) },
    credentials: { resolve: async () => credential }, client: observedCreates.factory,
  }, { deliveryId, issue: { title: "Existing", body: "Existing" }, pullRequest: { title: "Existing", body: "Existing" } });
  observedCreates.stop();
  assert.equal(first.issue.state, "discovered"); assert.equal(first.pullRequest.state, "discovered");
  const eligible = observedCreates.records();
  assert.deepEqual(eligible, {});
  assert.deepEqual(eligible, createdFixtureRecordNumbers(first));
  const requestsBeforeCleanup = requests.length;
  await closeCreatedPrivateFixtureRecords(actor, repository, repository, credential, client, eligible);
  assert.equal(requests.length, requestsBeforeCleanup);
  assert.ok(requests.every(request => request.method === "GET"));
  await assert.rejects(closeCreatedPrivateFixtureRecords(actor, "acme/other", repository, credential, client, eligible));
  assert.equal(requests.length, requestsBeforeCleanup);
});

test("private fixture revalidates a moved live head at the guarded mutation boundary before any POST", async () => {
  const actor = "fixture-actor"; const repository = "acme/disposable"; const deliveryId = "fixture-moving";
  const head = `shipyard/${deliveryId}`; const expectedSha = "a".repeat(40); let liveSha = expectedSha;
  const credential = Object.freeze({ authorizationValue: "test-token" }); const requests: GitHubRestRequest[] = [];
  const client: GitHubRestClientFactory = { forCredential(actual) {
    assert.equal(actual, credential);
    return { request: async <T>(request: GitHubRestRequest) => {
      requests.push(request);
      if (request.path === "/user") return { login: actor } as T;
      if (request.path.includes("/branches/")) return { name: head, commit: { sha: liveSha } } as T;
      if (request.path.includes("/issues?") || request.path.includes("/pulls?")) return [] as T;
      return assert.fail(`moved-head fixture must not write: ${request.method} ${request.path}`);
    } };
  } };
  await preflightPrivateFixture(actor, repository, repository, head, expectedSha, credential, client);
  liveSha = "b".repeat(40);
  const observedCreates = observePrivateFixtureCreates(repository, repository, client);
  const topology = { kind: "single-repository" as const, repository: { owner: "acme", name: "disposable", remote: { name: "origin", url: `https://github.com/${repository}.git` }, defaultBranch: "main" } };
  const bound = { resolve: async () => ({ profileName: "private-fixture", commonDirectory: "/fixture/.git", profileFingerprint: "0".repeat(64), actorLogin: actor, topology }) };
  const guard = new PrewriteFixtureGuard(new MutationLockService(new MemoryFilesystem(), new FakeProcess()), bound, () => preflightPrivateFixture(actor, repository, repository, head, expectedSha, credential, client));
  await assert.rejects(trackDevelopmentRecords({
    repositoryPath: "/fixture", guard,
    trackingAuthority: { resolve: async () => ({ commonDirectory: "/fixture/.git", actorLogin: actor, repository: topology.repository, head, base: "main", expectedHeadSha: expectedSha }) },
    credentials: { resolve: async () => credential }, client: observedCreates.factory,
  }, { deliveryId, issue: { title: "Moving", body: "Moving" }, pullRequest: { title: "Moving", body: "Moving" } }), (error: unknown) => error instanceof GitHubAuthorityError && error.code === "request-failed");
  observedCreates.stop();
  assert.deepEqual(observedCreates.records(), {});
  assert.ok(requests.every(request => request.method === "GET"));
  assert.equal(requests.filter(request => request.path.includes("/branches/")).length, 2, "one initial and one mutation-bound live-head check are required");
});

test("private fixture cleans only an observed issue POST when the head moves before the pull-request POST", async () => {
  const actor = "fixture-actor"; const repository = "acme/disposable"; const deliveryId = "fixture-partial";
  const head = `shipyard/${deliveryId}`; const expectedSha = "a".repeat(40); let liveSha = expectedSha;
  const credential = Object.freeze({ authorizationValue: "test-token" }); const requests: GitHubRestRequest[] = [];
  let storedIssue: unknown;
  const client: GitHubRestClientFactory = { forCredential(actual) {
    assert.equal(actual, credential);
    return { request: async <T>(request: GitHubRestRequest) => {
      requests.push(request);
      if (request.path === "/user") return { login: actor } as T;
      if (request.path.includes("/branches/")) return { name: head, commit: { sha: liveSha } } as T;
      if (request.method === "GET" && request.path.includes("/issues?")) return (storedIssue === undefined ? [] : [storedIssue]) as T;
      if (request.method === "GET" && request.path.includes("/pulls?")) return [] as T;
      if (request.method === "POST" && request.path === "/repos/acme/disposable/issues") {
        liveSha = "b".repeat(40);
        const created = { id: "I_created", number: 17, html_url: `https://github.test/${repository}/issues/17` };
        storedIssue = { ...created, body: (request.body as { body: string }).body };
        return created as T;
      }
      if (request.method === "PATCH" && request.path === "/repos/acme/disposable/issues/17") return {} as T;
      return assert.fail(`partial fixture attempted an unexpected provider request: ${request.method} ${request.path}`);
    } };
  } };
  await preflightPrivateFixture(actor, repository, repository, head, expectedSha, credential, client);
  const observedCreates = observePrivateFixtureCreates(repository, repository, client);
  const topology = { kind: "single-repository" as const, repository: { owner: "acme", name: "disposable", remote: { name: "origin", url: `https://github.com/${repository}.git` }, defaultBranch: "main" } };
  const bound = { resolve: async () => ({ profileName: "private-fixture", commonDirectory: "/fixture/.git", profileFingerprint: "0".repeat(64), actorLogin: actor, topology }) };
  const guard = new PrewriteFixtureGuard(new MutationLockService(new MemoryFilesystem(), new FakeProcess()), bound, () => preflightPrivateFixture(actor, repository, repository, head, expectedSha, credential, client));
  await assert.rejects(trackDevelopmentRecords({
    repositoryPath: "/fixture", guard,
    trackingAuthority: { resolve: async () => ({ commonDirectory: "/fixture/.git", actorLogin: actor, repository: topology.repository, head, base: "main", expectedHeadSha: expectedSha }) },
    credentials: { resolve: async () => credential }, client: observedCreates.factory,
  }, { deliveryId, issue: { title: "Partial", body: "Partial" }, pullRequest: { title: "Partial", body: "Partial" } }), (error: unknown) => error instanceof GitHubAuthorityError && error.code === "request-failed");
  observedCreates.stop();
  assert.deepEqual(observedCreates.records(), { issue: 17 });
  assert.deepEqual(requests.filter(request => request.method === "POST").map(request => request.path), ["/repos/acme/disposable/issues"]);

  await closeCreatedPrivateFixtureRecords(actor, repository, repository, credential, client, observedCreates.records());
  assert.deepEqual(requests.filter(request => request.method === "PATCH"), [
    { method: "PATCH", path: "/repos/acme/disposable/issues/17", body: { state: "closed" } },
  ]);
});

type TrackingCheckpoint = Awaited<ReturnType<typeof trackDevelopmentRecords>>;

function createdFixtureRecordNumbers(checkpoint: TrackingCheckpoint): Readonly<{ issue?: number; pullRequest?: number }> {
  return {
    ...(checkpoint.issue.state === "created" ? { issue: checkpoint.issue.number } : {}),
    ...(checkpoint.pullRequest.state === "created" ? { pullRequest: checkpoint.pullRequest.number } : {}),
  };
}

function observePrivateFixtureCreates(
  repository: string,
  separatelyApprovedRepository: string,
  underlying: GitHubRestClientFactory,
): Readonly<{
  factory: GitHubRestClientFactory;
  records(): Readonly<{ issue?: number; pullRequest?: number }>;
  stop(): void;
}> {
  assert.equal(repository, separatelyApprovedRepository, "fixture observer repository must exactly equal the separately approved disposable repository");
  const { basePath } = fixtureRepository(repository);
  let active = true; let issue: number | undefined; let pullRequest: number | undefined;
  const factory: GitHubRestClientFactory = { forCredential(credential) {
    const client = underlying.forCredential(credential);
    return { request: async <T>(request: GitHubRestRequest) => {
      const response = await client.request<T>(request);
      if (active && request.method === "POST") {
        const number = positiveProviderRecordNumber(response);
        if (request.path === `${basePath}/issues` && number !== undefined) {
          if (issue !== undefined) assert.equal(issue, number, "fixture observed more than one created issue");
          issue = number;
        }
        if (request.path === `${basePath}/pulls` && number !== undefined) {
          if (pullRequest !== undefined) assert.equal(pullRequest, number, "fixture observed more than one created pull request");
          pullRequest = number;
        }
      }
      return response;
    } };
  } };
  return Object.freeze({
    factory,
    records: () => ({ ...(issue === undefined ? {} : { issue }), ...(pullRequest === undefined ? {} : { pullRequest }) }),
    stop: () => { active = false; },
  });
}

function positiveProviderRecordNumber(value: unknown): number | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const number = (value as { number?: unknown }).number;
  return typeof number === "number" && Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function deliveryIdFromFixtureHead(head: string): string {
  const prefix = "shipyard/";
  assert.ok(head.startsWith(prefix), "fixture head must be the canonical branch for its delivery ID");
  const deliveryId = stableDeliveryId(head.slice(prefix.length));
  canonicalWorkspaceBranch(head, deliveryId);
  return deliveryId;
}

async function preflightPrivateFixture(
  expectedActor: string,
  repository: string,
  separatelyApprovedRepository: string,
  head: string,
  expectedSha: string,
  credential: GitHubApiCredential,
  factory: GitHubRestClientFactory,
): Promise<void> {
  assert.equal(repository, separatelyApprovedRepository, "fixture repository must exactly equal the separately approved disposable repository");
  const { basePath } = fixtureRepository(repository);
  deliveryIdFromFixtureHead(head);
  assert.match(expectedSha, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
  const client = factory.forCredential(credential);
  const viewer = await client.request<{ login?: unknown }>({ method: "GET", path: "/user" });
  if (viewer.login !== expectedActor) throw new GitHubAuthorityError("actor-mismatch", "GitHub authenticated actor does not match the configured fixture actor.");
  const branch = await client.request<{ name?: unknown; commit?: { sha?: unknown } }>({ method: "GET", path: `${basePath}/branches/${encodeURIComponent(head)}` });
  if (branch.name !== head || branch.commit?.sha !== expectedSha) {
    throw new GitHubAuthorityError("request-failed", "GitHub fixture head branch does not match the configured canonical ref and SHA.");
  }
}

class PrewriteFixtureGuard extends DevelopmentRecordGuard {
  constructor(
    locks: MutationLockService,
    bound: BoundProfileAuthorityResolver,
    private readonly prewrite: () => Promise<void>,
  ) { super(locks, bound); }

  override async revalidate(repositoryPath: string, expected: BoundProfileAuthority): Promise<BoundProfileAuthority> {
    const current = await super.revalidate(repositoryPath, expected);
    await this.prewrite();
    return current;
  }
}

async function closeCreatedPrivateFixtureRecords(
  expectedActor: string,
  repository: string,
  separatelyApprovedRepository: string,
  credential: GitHubApiCredential,
  factory: GitHubRestClientFactory,
  records: Readonly<{ issue?: number; pullRequest?: number }>,
): Promise<void> {
  assert.equal(repository, separatelyApprovedRepository, "fixture cleanup repository must exactly equal the separately approved disposable repository");
  fixtureRepository(repository);
  const issue = fixtureRecordNumber(records.issue); const pullRequest = fixtureRecordNumber(records.pullRequest);
  if (issue === undefined && pullRequest === undefined) return;
  await closePrivateFixtureRecords(expectedActor, repository, separatelyApprovedRepository, credential, factory, { issue, pullRequest });
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
