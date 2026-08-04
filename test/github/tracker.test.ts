import assert from "node:assert/strict";
import test from "node:test";
import { stableShipyardMarker } from "../../src/github/markers.js";
import { trackDevelopmentRecords } from "../../src/github/tracker.js";
import type { Topology } from "../../src/contracts/types.js";
import type { DevelopmentRecordAuthority, DevelopmentRecordMutationGuard } from "../../src/github/tracker.js";
import type { GitHubRestRequest } from "../../src/github/types.js";

const development = { owner: "acme", name: "development", remote: { name: "origin", url: "https://github.com/acme/development.git" }, defaultBranch: "main" };
const destination = { owner: "acme", name: "destination", remote: { name: "origin", url: "https://github.com/acme/destination.git" }, defaultBranch: "main" };
const staged: Topology = { kind: "staged-pair", development, destination };
const single: Topology = { kind: "single-repository", repository: development };
const request = { deliveryId: "delivery-42", issue: { title: "Implement widget", body: "Work item" }, pullRequest: { title: "Implement widget", body: "Ready for review", head: "shipyard/delivery-42", base: "main", expectedHeadSha: "a".repeat(40) } };
const matchingPullRequestFields = { head: { sha: request.pullRequest.expectedHeadSha, ref: request.pullRequest.head }, base: { ref: request.pullRequest.base } };

class SerialGuard implements DevelopmentRecordMutationGuard {
  private tail = Promise.resolve();
  async exclusive<T>(_deliveryId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await prior;
    try { return await operation(); } finally { release(); }
  }
}

class RecordingApi {
  readonly calls: GitHubRestRequest[] = [];
  constructor(private readonly respond: (request: GitHubRestRequest) => unknown | Promise<unknown>) {}
  authority(): DevelopmentRecordAuthority {
    return {
      expectedActorLogin: "shipyard-actor",
      credentials: { resolve: async () => ({ authorizationValue: "test-token" }) },
      client: { forCredential: () => ({ request: async <T>(call: GitHubRestRequest) => {
        this.calls.push(call);
        return this.respond(call) as Promise<T>;
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
  const checkpoint = await trackDevelopmentRecords(api.authority(), new SerialGuard(), staged, request);
  assert.deepEqual(api.calls.map(call => [call.method, call.path]), [["GET", "/user"], ["GET", "/repos/acme/development/issues?state=all&per_page=100&page=1"], ["GET", "/repos/acme/development/pulls?state=all&per_page=100&page=1"], ["POST", "/repos/acme/development/issues"], ["POST", "/repos/acme/development/pulls"]]);
  assert.ok(api.writes.every(call => call.path.includes("/acme/development/")));
  assert.equal((api.writes[0].body as { body: string }).body, `Work item\n\n${marker}`);
  assert.equal((api.writes[1].body as { body: string }).body, `Ready for review\n\n${marker}`);
  assert.equal(checkpoint.actorLogin, "shipyard-actor");
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
  const checkpoint = await trackDevelopmentRecords(api.authority(), new SerialGuard(), single, request);
  assert.equal(checkpoint.issue.id, "I_marked");
  assert.equal(api.writes.length, 0);
  assert.ok(api.calls.some(call => call.path.endsWith("issues?state=all&per_page=100&page=2")));
});

test("preflight rejects unsafe PR state before creating an issue", async () => {
  const marker = stableShipyardMarker(request.deliveryId);
  const api = new RecordingApi(rest => {
    if (rest.path === "/user") return { login: "shipyard-actor" };
    if (isIssuesPage(rest.path)) return [];
    if (rest.path.includes("/pulls?")) return [{ id: "PR_1", number: 2, html_url: "https://github.test/pull/2", body: marker, pull_request: {}, head: { sha: "b".repeat(40), ref: request.pullRequest.head }, base: { ref: request.pullRequest.base } }];
    throw new Error(`unexpected request: ${rest.path}`);
  });
  await assert.rejects(trackDevelopmentRecords(api.authority(), new SerialGuard(), staged, request), { code: "head-sha-mismatch" });
  assert.equal(api.writes.length, 0);
});

for (const [field, record, code] of [
  ["head ref", { ...matchingPullRequestFields, head: { sha: request.pullRequest.expectedHeadSha, ref: "wrong-branch" } }, "head-ref-mismatch"],
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
    await assert.rejects(trackDevelopmentRecords(api.authority(), new SerialGuard(), staged, request), { code });
    assert.equal(api.writes.length, 0);
  });
}

test("fails closed when a newly-created PR response has the wrong head SHA", async () => {
  const api = new RecordingApi(rest => {
    if (rest.path === "/user") return { login: "shipyard-actor" };
    if (rest.method === "GET") return [];
    if (rest.path.endsWith("/issues")) return { id: "I_1", number: 1, html_url: "https://github.test/issues/1" };
    return { id: "PR_1", number: 2, html_url: "https://github.test/pull/2", head: { sha: "b".repeat(40), ref: request.pullRequest.head }, base: { ref: request.pullRequest.base } };
  });
  await assert.rejects(trackDevelopmentRecords(api.authority(), new SerialGuard(), staged, request), { code: "head-sha-mismatch" });
  assert.deepEqual(api.writes.map(call => call.path), ["/repos/acme/development/issues", "/repos/acme/development/pulls"]);
});

test("rejects a newly-created PR response with the wrong head or base ref", async () => {
  for (const [record, code] of [
    [{ ...matchingPullRequestFields, head: { sha: request.pullRequest.expectedHeadSha, ref: "wrong" } }, "head-ref-mismatch"],
    [{ ...matchingPullRequestFields, base: { ref: "wrong" } }, "base-ref-mismatch"],
  ] as const) {
    const api = new RecordingApi(rest => {
      if (rest.path === "/user") return { login: "shipyard-actor" };
      if (rest.method === "GET") return [];
      if (rest.path.endsWith("/issues")) return { id: "I_1", number: 1, html_url: "https://github.test/issues/1" };
      return { id: "PR_1", number: 2, html_url: "https://github.test/pull/2", ...record };
    });
    await assert.rejects(trackDevelopmentRecords(api.authority(), new SerialGuard(), staged, request), { code });
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
    await assert.rejects(trackDevelopmentRecords(api.authority(), new SerialGuard(), staged, { ...request, resume: scenario.resume }), { code: scenario.code });
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
  const checkpoint = await trackDevelopmentRecords(api.authority(), new SerialGuard(), staged, request);
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
  const checkpoint = await trackDevelopmentRecords(api.authority(), new SerialGuard(), staged, request);
  assert.equal(checkpoint.issue.id, "I_created");
  assert.equal(checkpoint.pullRequest.id, "PR_1");
  assert.deepEqual(api.writes.map(call => call.path), ["/repos/acme/development/issues"]);
});

test("fails closed rather than loop forever on unbounded full provider pages", async () => {
  const fullPage = Array.from({ length: 100 }, (_, number) => ({ id: `I_${number}`, number, html_url: `https://github.test/issues/${number}`, body: "unmarked" }));
  const api = new RecordingApi(rest => rest.path === "/user" ? { login: "shipyard-actor" } : fullPage);
  await assert.rejects(trackDevelopmentRecords(api.authority(), new SerialGuard(), staged, request), { code: "pagination-limit" });
  assert.equal(api.writes.length, 0);
  assert.ok(api.calls.length <= 201, "pagination scan must be bounded");
});

test("a durable guard serializes concurrent tracking calls to one issue/PR pair", async () => {
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
  const guard = new SerialGuard();
  const [first, second] = await Promise.all([trackDevelopmentRecords(api.authority(), guard, staged, request), trackDevelopmentRecords(api.authority(), guard, staged, request)]);
  assert.equal(api.writes.filter(call => call.path.endsWith("/issues")).length, 1);
  assert.equal(api.writes.filter(call => call.path.endsWith("/pulls")).length, 1);
  assert.equal(first.issue.id, second.issue.id);
  assert.equal(first.pullRequest.id, second.pullRequest.id);
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
  const guard = new SerialGuard();
  await assert.rejects(trackDevelopmentRecords(api.authority(), guard, staged, request));
  const resumed = await trackDevelopmentRecords(api.authority(), guard, staged, request);
  assert.equal(resumed.issue.state, "discovered");
  assert.equal(resumed.pullRequest.state, "created");
  assert.equal(api.writes.filter(call => call.path.endsWith("/issues")).length, 1);
});
