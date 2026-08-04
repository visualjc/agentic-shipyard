import assert from "node:assert/strict";
import test from "node:test";
import { GitHubTrackerError, stableShipyardMarker } from "../../src/github/markers.js";
import { trackDevelopmentRecords } from "../../src/github/tracker.js";
import type { Topology } from "../../src/contracts/types.js";
import type { DevelopmentRecordAuthority } from "../../src/github/tracker.js";
import type { GitHubRestRequest } from "../../src/github/types.js";
import { DevelopmentRecordGuard } from "../../src/github/tracking-guard.js";
import { MutationLockError, MutationLockService } from "../../src/locking/mutation-lock.js";
import { FakeProcess, MemoryFilesystem } from "../helpers/fakes.js";

const development = { owner: "acme", name: "development", remote: { name: "origin", url: "https://github.com/acme/development.git" }, defaultBranch: "main" };
const githubDevelopment = { name: "development", full_name: "acme/development", owner: { login: "acme" } };
const destination = { owner: "acme", name: "destination", remote: { name: "origin", url: "https://github.com/acme/destination.git" }, defaultBranch: "main" };
const staged: Topology = { kind: "staged-pair", development, destination };
const single: Topology = { kind: "single-repository", repository: development };
const request = { deliveryId: "delivery-42", issue: { title: "Implement widget", body: "Work item" }, pullRequest: { title: "Implement widget", body: "Ready for review" } };
const trusted = { head: "shipyard/delivery-42", base: "main", expectedHeadSha: "a".repeat(40) };
const matchingPullRequestFields = { head: { sha: trusted.expectedHeadSha, ref: trusted.head, repo: githubDevelopment }, base: { ref: trusted.base } };

class RecordingApi {
  readonly calls: GitHubRestRequest[] = [];
  private readonly filesystem = new MemoryFilesystem();
  private readonly process = new FakeProcess();
  private readonly records = { issues: [] as unknown[], pulls: [] as unknown[] };
  constructor(private readonly respond: (request: GitHubRestRequest) => unknown | Promise<unknown>) {}
  authority(topology: Topology = staged): DevelopmentRecordAuthority {
    return {
      repositoryPath: "/worktree",
      guard: new DevelopmentRecordGuard(new MutationLockService(this.filesystem, this.process), { resolve: async () => ({ profileName: "test", commonDirectory: "/worktree/.git", profileFingerprint: "0".repeat(64), actorLogin: "shipyard-actor", topology }) }),
      trackingAuthority: { resolve: async () => ({ commonDirectory: "/worktree/.git", actorLogin: "shipyard-actor", repository: topology.kind === "staged-pair" ? topology.development : topology.repository, ...trusted }) },
      credentials: { resolve: async () => ({ authorizationValue: "test-token" }) },
      client: { forCredential: () => ({ request: async <T>(call: GitHubRestRequest) => {
        this.calls.push(call);
        const response = await this.respond(call);
        if (call.method === "POST" && typeof response === "object" && response !== null) {
          const record = { ...(response as object), body: (call.body as { body: string }).body };
          if (call.path.endsWith("/issues")) this.records.issues.push(record);
          else this.records.pulls.push(record);
        }
        if (call.method === "GET" && Array.isArray(response)) {
          const stored = isIssuesPage(call.path) ? this.records.issues : call.path.includes("/pulls?") ? this.records.pulls : [];
          const ids = new Set(response.map(record => typeof record === "object" && record !== null ? (record as { id?: unknown }).id : undefined));
          return [...response, ...stored.filter(record => !ids.has((record as { id?: unknown }).id))] as T;
        }
        return response as T;
      } }) },
    };
  }
  get writes(): GitHubRestRequest[] { return this.calls.filter(call => call.method !== "GET"); }
}

function isIssuesPage(path: string): boolean { return path.startsWith("/repos/acme/development/issues?"); }

test("verifies the actor first and creates the staged-pair issue and PR only in development", async () => {
  const marker = stableShipyardMarker(request.deliveryId);
  const api = new RecordingApi(rest => {
    if (rest.path === "/user") return { login: "shipyard-actor" };
    if (rest.method === "GET") return [];
    if (rest.path.endsWith("/issues")) return { id: "I_1", number: 17, html_url: "https://github.test/acme/development/issues/17" };
    return { id: "PR_1", number: 23, html_url: "https://github.test/acme/development/pull/23", ...matchingPullRequestFields };
  });
  const checkpoint = await trackDevelopmentRecords(api.authority(), request);
  assert.deepEqual(api.calls.map(call => [call.method, call.path]), [["GET", "/user"], ["GET", "/repos/acme/development/issues?state=all&per_page=100&page=1"], ["GET", "/repos/acme/development/pulls?state=all&per_page=100&page=1"], ["POST", "/repos/acme/development/issues"], ["GET", "/repos/acme/development/issues?state=all&per_page=100&page=1"], ["POST", "/repos/acme/development/pulls"], ["GET", "/repos/acme/development/pulls?state=all&per_page=100&page=1"]]);
  assert.ok(api.writes.every(call => call.path.includes("/acme/development/")));
  assert.equal((api.writes[0].body as { body: string }).body, `Work item\n\n${marker}`);
  assert.equal((api.writes[1].body as { body: string }).body, `Ready for review\n\n${marker}`);
  assert.equal(checkpoint.actorLogin, "shipyard-actor");
});

test("a destination-returning resolver cannot escape a real staged-pair bound guard", async () => {
  const api = new RecordingApi(rest => rest.path === "/user" ? { login: "shipyard-actor" } : []);
  const authority = api.authority(staged);
  authority.trackingAuthority = { resolve: async () => ({ commonDirectory: "/worktree/.git", actorLogin: "shipyard-actor", repository: destination, ...trusted }) };
  await assert.rejects(trackDevelopmentRecords(authority, request), { code: "authority-mismatch" });
  assert.equal(api.calls.length, 0, "the bound topology check happens before actor verification or a REST write");
  assert.equal(api.writes.length, 0);
});

test("a caller-injected resolver cannot select an arbitrary development head, base, or SHA", async () => {
  for (const override of [
    { head: "feature/unbound" },
    { base: "release" },
    { expectedHeadSha: "not-a-commit" },
  ]) {
    const api = new RecordingApi(rest => rest.path === "/user" ? { login: "shipyard-actor" } : []);
    const authority = api.authority(staged);
    authority.trackingAuthority = { resolve: async () => ({ commonDirectory: "/worktree/.git", actorLogin: "shipyard-actor", repository: development, ...trusted, ...override }) };
    await assert.rejects(trackDevelopmentRecords(authority, request), { code: "authority-mismatch" });
    assert.equal(api.calls.length, 0);
    assert.equal(api.writes.length, 0);
  }
});

test("does not report a POST as success until marker discovery confirms it", async () => {
  const api = new RecordingApi(rest => {
    if (rest.path === "/user") return { login: "shipyard-actor" };
    if (rest.method === "GET") return [];
    return rest.path.endsWith("/issues")
      ? { id: "I_1", number: 1, html_url: "https://github.test/issues/1" }
      : { id: "PR_1", number: 2, html_url: "https://github.test/pull/2", ...matchingPullRequestFields };
  });
  // Avoid the fixture's normal local visibility shim to model provider lag.
  const authority = api.authority();
  authority.client = { forCredential: () => ({ request: async <T>(call: GitHubRestRequest) => {
    api.calls.push(call);
    if (call.path === "/user") return { login: "shipyard-actor" } as T;
    if (call.method === "GET") return [] as T;
    return { id: "I_1", number: 1, html_url: "https://github.test/issues/1" } as T;
  } }) };
  await assert.rejects(trackDevelopmentRecords(authority, request), (error: unknown) => error instanceof GitHubTrackerError && error.code === "write-unconfirmed" && error.message.includes("manually review"));
  assert.equal(api.writes.length, 1);
});

test("exhausts pagination and discovers a marked record on a later page", async () => {
  const marker = stableShipyardMarker(request.deliveryId);
  const issuePage = Array.from({ length: 100 }, (_, number) => ({ id: `I_${number}`, number, html_url: `https://github.test/issues/${number}`, body: "unmarked" }));
  const api = new RecordingApi(rest => {
    if (rest.path === "/user") return { login: "shipyard-actor" };
    if (isIssuesPage(rest.path) && rest.path.endsWith("page=1")) return issuePage;
    if (isIssuesPage(rest.path)) return [{ id: "I_marked", number: 101, html_url: "https://github.test/issues/101", body: marker }];
    if (rest.method === "GET") return [{ id: "PR_marked", number: 102, html_url: "https://github.test/pull/102", body: marker, ...matchingPullRequestFields }];
    throw new Error("unexpected write");
  });
  const checkpoint = await trackDevelopmentRecords(api.authority(single), request);
  assert.equal(checkpoint.issue.id, "I_marked");
  assert.equal(api.writes.length, 0);
  assert.ok(api.calls.some(call => call.path.endsWith("issues?state=all&per_page=100&page=2")));
});

test("preflight rejects unsafe PR state before creating an issue", async () => {
  const marker = stableShipyardMarker(request.deliveryId);
  const api = new RecordingApi(rest => {
    if (rest.path === "/user") return { login: "shipyard-actor" };
    if (isIssuesPage(rest.path)) return [];
    if (rest.path.includes("/pulls?")) return [{ id: "PR_1", number: 2, html_url: "https://github.test/pull/2", body: marker, pull_request: {}, head: { sha: "b".repeat(40), ref: trusted.head, repo: githubDevelopment }, base: { ref: trusted.base } }];
    throw new Error(`unexpected request: ${rest.path}`);
  });
  await assert.rejects(trackDevelopmentRecords(api.authority(), request), { code: "head-sha-mismatch" });
  assert.equal(api.writes.length, 0);
});

for (const [field, record, code] of [
  ["head ref", { ...matchingPullRequestFields, head: { sha: trusted.expectedHeadSha, ref: "wrong-branch", repo: githubDevelopment } }, "head-ref-mismatch"],
  ["base ref", { ...matchingPullRequestFields, base: { ref: "wrong-base" } }, "base-ref-mismatch"],
] as const) {
  test(`preflight rejects a discovered PR with the wrong ${field} before any write`, async () => {
    const marker = stableShipyardMarker(request.deliveryId);
    const api = new RecordingApi(rest => {
      if (rest.path === "/user") return { login: "shipyard-actor" };
      if (isIssuesPage(rest.path)) return [];
      if (rest.path.includes("/pulls?")) return [{ id: "PR_1", number: 2, html_url: "https://github.test/pull/2", body: marker, ...record }];
      throw new Error(`unexpected request: ${rest.path}`);
    });
    await assert.rejects(trackDevelopmentRecords(api.authority(), request), { code });
    assert.equal(api.writes.length, 0);
  });
}

test("fails closed when a newly-created PR response has the wrong head SHA", async () => {
  const api = new RecordingApi(rest => {
    if (rest.path === "/user") return { login: "shipyard-actor" };
    if (rest.method === "GET") return [];
    if (rest.path.endsWith("/issues")) return { id: "I_1", number: 1, html_url: "https://github.test/issues/1" };
    return { id: "PR_1", number: 2, html_url: "https://github.test/pull/2", head: { sha: "b".repeat(40), ref: trusted.head, repo: githubDevelopment }, base: { ref: trusted.base } };
  });
  await assert.rejects(trackDevelopmentRecords(api.authority(), request), { code: "head-sha-mismatch" });
  assert.deepEqual(api.writes.map(call => call.path), ["/repos/acme/development/issues", "/repos/acme/development/pulls"]);
});

test("rejects a newly-created PR response with the wrong head or base ref", async () => {
  for (const [record, code] of [
    [{ ...matchingPullRequestFields, head: { sha: trusted.expectedHeadSha, ref: "wrong", repo: githubDevelopment } }, "head-ref-mismatch"],
    [{ ...matchingPullRequestFields, base: { ref: "wrong" } }, "base-ref-mismatch"],
  ] as const) {
    const api = new RecordingApi(rest => {
      if (rest.path === "/user") return { login: "shipyard-actor" };
      if (rest.method === "GET") return [];
      if (rest.path.endsWith("/issues")) return { id: "I_1", number: 1, html_url: "https://github.test/issues/1" };
      return { id: "PR_1", number: 2, html_url: "https://github.test/pull/2", ...record };
    });
    await assert.rejects(trackDevelopmentRecords(api.authority(), request), { code });
    assert.deepEqual(api.writes.map(call => call.path), ["/repos/acme/development/issues", "/repos/acme/development/pulls"]);
  }
});

test("rejects duplicate marked records and mismatched or absent checkpoint IDs", async () => {
  const marker = stableShipyardMarker(request.deliveryId);
  const cases: readonly { readonly name: string; readonly resume?: { readonly issueId?: string }; readonly issues: unknown; readonly code: string }[] = [
    { name: "duplicates", issues: [{ id: "I_1", number: 1, html_url: "https://github.test/issues/1", body: marker }, { id: "I_2", number: 2, html_url: "https://github.test/issues/2", body: marker }], code: "ambiguous-record" },
    { name: "checkpoint mismatch", resume: { issueId: "I_expected" }, issues: [{ id: "I_1", number: 1, html_url: "https://github.test/issues/1", body: marker }], code: "resume-mismatch" },
    { name: "checkpoint absence", resume: { issueId: "I_expected" }, issues: [], code: "resume-mismatch" },
  ];
  for (const scenario of cases) {
    const api = new RecordingApi(rest => {
      if (rest.path === "/user") return { login: "shipyard-actor" };
      if (isIssuesPage(rest.path)) return scenario.issues;
      if (rest.method === "GET") return [];
      throw new Error(`unexpected write for ${scenario.name}`);
    });
    await assert.rejects(trackDevelopmentRecords(api.authority(), { ...request, resume: scenario.resume }), { code: scenario.code });
    assert.equal(api.writes.length, 0, scenario.name);
  }
});

test("requires the marker to occupy a standalone body line", async () => {
  const marker = stableShipyardMarker(request.deliveryId);
  const api = new RecordingApi(rest => {
    if (rest.path === "/user") return { login: "shipyard-actor" };
    if (isIssuesPage(rest.path)) return [{ id: "I_substring", number: 1, html_url: "https://github.test/issues/1", body: `prefix ${marker}` }];
    if (rest.method === "GET") return [{ id: "PR_1", number: 2, html_url: "https://github.test/pull/2", body: marker, ...matchingPullRequestFields }];
    if (rest.path.endsWith("/issues")) return { id: "I_created", number: 3, html_url: "https://github.test/issues/3" };
    throw new Error(`unexpected request: ${rest.path}`);
  });
  const checkpoint = await trackDevelopmentRecords(api.authority(), request);
  assert.equal(checkpoint.issue.state, "created");
  assert.equal(checkpoint.pullRequest.state, "discovered");
  assert.deepEqual(api.writes.map(call => call.path), ["/repos/acme/development/issues"]);
});

test("excludes pull request objects from the issues listing", async () => {
  const marker = stableShipyardMarker(request.deliveryId);
  const api = new RecordingApi(rest => {
    if (rest.path === "/user") return { login: "shipyard-actor" };
    if (isIssuesPage(rest.path)) return [{ id: "PR_in_issues", number: 1, html_url: "https://github.test/pull/1", body: marker, pull_request: {}, ...matchingPullRequestFields }];
    if (rest.method === "GET") return [{ id: "PR_1", number: 2, html_url: "https://github.test/pull/2", body: marker, ...matchingPullRequestFields }];
    if (rest.path.endsWith("/issues")) return { id: "I_created", number: 3, html_url: "https://github.test/issues/3" };
    throw new Error(`unexpected request: ${rest.path}`);
  });
  const checkpoint = await trackDevelopmentRecords(api.authority(), request);
  assert.equal(checkpoint.issue.id, "I_created");
  assert.equal(checkpoint.pullRequest.id, "PR_1");
  assert.deepEqual(api.writes.map(call => call.path), ["/repos/acme/development/issues"]);
});

test("fails closed rather than loop forever on unbounded full provider pages", async () => {
  const fullPage = Array.from({ length: 100 }, (_, number) => ({ id: `I_${number}`, number, html_url: `https://github.test/issues/${number}`, body: "unmarked" }));
  const api = new RecordingApi(rest => rest.path === "/user" ? { login: "shipyard-actor" } : fullPage);
  await assert.rejects(trackDevelopmentRecords(api.authority(), request), { code: "pagination-limit" });
  assert.equal(api.writes.length, 0);
  assert.ok(api.calls.length <= 201, "pagination scan must be bounded");
});

test("a concrete durable guard rejects a concurrent second tracker instance", async () => {
  const marker = stableShipyardMarker(request.deliveryId);
  let issueCreated = false;
  let prCreated = false;
  const api = new RecordingApi(rest => {
    if (rest.path === "/user") return { login: "shipyard-actor" };
    if (rest.method === "GET" && isIssuesPage(rest.path)) return issueCreated ? [{ id: "I_1", number: 1, html_url: "https://github.test/issues/1", body: marker }] : [];
    if (rest.method === "GET") return prCreated ? [{ id: "PR_1", number: 2, html_url: "https://github.test/pull/2", body: marker, ...matchingPullRequestFields }] : [];
    if (rest.path.endsWith("/issues")) { issueCreated = true; return { id: "I_1", number: 1, html_url: "https://github.test/issues/1" }; }
    prCreated = true; return { id: "PR_1", number: 2, html_url: "https://github.test/pull/2", ...matchingPullRequestFields };
  });
  const [first, second] = await Promise.allSettled([trackDevelopmentRecords(api.authority(), request), trackDevelopmentRecords(api.authority(), request)]);
  assert.equal([first, second].filter(result => result.status === "fulfilled").length, 1);
  assert.equal([first, second].filter(result => result.status === "rejected").length, 1);
});

test("independent common-directory guards surface a concurrent create as ambiguity, never global exactly-once success", async () => {
  const marker = stableShipyardMarker(request.deliveryId);
  const issues: unknown[] = [];
  const pulls: unknown[] = [];
  const bothPosts = Promise.withResolvers<void>(); const releasePosts = Promise.withResolvers<void>();
  const client = { forCredential: () => ({ request: async <T>(call: GitHubRestRequest) => {
    if (call.path === "/user") return { login: "shipyard-actor" } as T;
    if (isIssuesPage(call.path)) return issues as T;
    if (call.path.includes("/pulls?")) return pulls as T;
    if (call.path.endsWith("/issues")) {
      const record = { id: `I_${issues.length + 1}`, number: issues.length + 1, html_url: `https://github.test/issues/${issues.length + 1}`, body: (call.body as { body: string }).body };
      issues.push(record);
      if (issues.length === 2) bothPosts.resolve();
      await releasePosts.promise;
      return record as T;
    }
    throw new Error("a duplicate issue must prevent PR creation");
  } }) };
  const independentAuthority = (): DevelopmentRecordAuthority => ({
    repositoryPath: "/worktree",
    guard: new DevelopmentRecordGuard(new MutationLockService(new MemoryFilesystem(), new FakeProcess()), { resolve: async () => ({ profileName: "test", commonDirectory: "/worktree/.git", profileFingerprint: "0".repeat(64), actorLogin: "shipyard-actor", topology: staged }) }),
    trackingAuthority: { resolve: async () => ({ commonDirectory: "/worktree/.git", actorLogin: "shipyard-actor", repository: development, ...trusted }) },
    credentials: { resolve: async () => ({ authorizationValue: "test-token" }) }, client,
  });
  const first = trackDevelopmentRecords(independentAuthority(), request);
  const second = trackDevelopmentRecords(independentAuthority(), request);
  await bothPosts.promise;
  releasePosts.resolve();
  const results = await Promise.allSettled([first, second]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 0);
  assert.ok(results.every(result => result.status === "rejected" && (result.reason as GitHubTrackerError).code === "ambiguous-record"));
  assert.equal(issues.length, 2);
  assert.ok(issues.every(record => typeof record === "object" && record !== null && (record as { body?: string }).body?.includes(marker)));
  assert.equal(pulls.length, 0);
});

test("holds the workspace lifecycle lock through discovery and revalidates before a write", async () => {
  const filesystem = new MemoryFilesystem(); const process = new FakeProcess();
  const viewerEntered = Promise.withResolvers<void>(); const releaseViewer = Promise.withResolvers<void>();
  let authorityResolves = 0; let posts = 0;
  const authority: DevelopmentRecordAuthority = {
    repositoryPath: "/worktree",
    guard: new DevelopmentRecordGuard(new MutationLockService(filesystem, process), { resolve: async () => ({ profileName: "test", commonDirectory: "/worktree/.git", profileFingerprint: "0".repeat(64), actorLogin: "shipyard-actor", topology: staged }) }),
    trackingAuthority: { async resolve() {
      authorityResolves += 1;
      if (authorityResolves > 1) throw new GitHubTrackerError("authority-mismatch", "delivery worktree was removed");
      return { commonDirectory: "/worktree/.git", actorLogin: "shipyard-actor", repository: development, ...trusted };
    } },
    credentials: { resolve: async () => ({ authorizationValue: "test-token" }) },
    client: { forCredential: () => ({ request: async <T>(call: GitHubRestRequest) => {
      if (call.path === "/user") { viewerEntered.resolve(); await releaseViewer.promise; return { login: "shipyard-actor" } as T; }
      if (call.method === "POST") posts += 1;
      return [] as T;
    } }) },
  };
  const tracking = trackDevelopmentRecords(authority, request);
  await viewerEntered.promise;
  const cleanup = new MutationLockService(filesystem, process);
  await assert.rejects(cleanup.acquire("/worktree/.git/shipyard-workspace.lock", "/worktree/.git", "workspace"), (error: unknown) => error instanceof MutationLockError && error.code === "lock-held");
  releaseViewer.resolve();
  await assert.rejects(tracking, (error: unknown) => error instanceof GitHubTrackerError && error.code === "authority-mismatch");
  assert.equal(posts, 0);
  assert.equal(authorityResolves, 2);
});

test("resumes a partially-created issue when the PR write previously failed", async () => {
  const marker = stableShipyardMarker(request.deliveryId);
  let issueCreated = false;
  let failPr = true;
  const api = new RecordingApi(rest => {
    if (rest.path === "/user") return { login: "shipyard-actor" };
    if (rest.method === "GET" && isIssuesPage(rest.path)) return issueCreated ? [{ id: "I_1", number: 1, html_url: "https://github.test/issues/1", body: marker }] : [];
    if (rest.method === "GET") return [];
    if (rest.path.endsWith("/issues")) { issueCreated = true; return { id: "I_1", number: 1, html_url: "https://github.test/issues/1" }; }
    if (failPr) { failPr = false; throw new Error("temporary provider failure"); }
    return { id: "PR_1", number: 2, html_url: "https://github.test/pull/2", ...matchingPullRequestFields };
  });
  await assert.rejects(trackDevelopmentRecords(api.authority(), request));
  const resumed = await trackDevelopmentRecords(api.authority(), request);
  assert.equal(resumed.issue.state, "discovered");
  assert.equal(resumed.pullRequest.state, "created");
  assert.equal(api.writes.filter(call => call.path.endsWith("/issues")).length, 1);
});
