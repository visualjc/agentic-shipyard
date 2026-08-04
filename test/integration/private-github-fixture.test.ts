import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

const enabled = process.env.SHIPYARD_PRIVATE_GITHUB_FIXTURE === "1";
const acknowledgement = "I_ACKNOWLEDGE_DISPOSABLE_GITHUB_MUTATIONS";

test("private fixture creates then idempotently discovers one approved development issue and PR", { skip: !enabled }, async () => {
  const repository = required("SHIPYARD_PRIVATE_GITHUB_REPOSITORY");
  assert.equal(repository, required("SHIPYARD_PRIVATE_GITHUB_APPROVED_REPOSITORY"), "fixture repository must exactly equal the separately approved disposable repository");
  assert.equal(required("SHIPYARD_PRIVATE_GITHUB_MUTATION_ACKNOWLEDGEMENT"), acknowledgement);
  const [owner, name] = repository.split("/");
  assert.match(repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.ok(owner !== "." && owner !== ".." && name !== "." && name !== ".." && !owner.includes("..") && !name.includes(".."));
  assert.notEqual(owner.toLowerCase(), "nativeinteractive");
  const actor = required("SHIPYARD_PRIVATE_GITHUB_ACTOR");
  const token = required("SHIPYARD_PRIVATE_GITHUB_TOKEN");
  const head = required("SHIPYARD_PRIVATE_GITHUB_HEAD_REF");
  const base = required("SHIPYARD_PRIVATE_GITHUB_BASE_REF");
  const sha = required("SHIPYARD_PRIVATE_GITHUB_HEAD_SHA");
  assert.match(head, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/); assert.ok(!head.includes(":") && !head.includes(".."));
  assert.match(base, /^[A-Za-z0-9][A-Za-z0-9._/-]*$/); assert.ok(!base.includes(":") && !base.includes(".."));
  assert.match(sha, /^[a-f0-9]{40}$/);
  const root = await mkdtemp(join(tmpdir(), "shipyard-private-tracker-"));
  const api = new GitHubRestAdapter({ resolve: async () => ({ authorizationValue: token }) }, new FetchGitHubRestTransport());
  const topology = { kind: "single-repository" as const, repository: { owner, name, remote: { name: "origin", url: `https://github.com/${repository}.git` }, defaultBranch: base } };
  const bound = { resolve: async () => ({ profileName: "private-fixture", commonDirectory: root, profileFingerprint: "0".repeat(64), actorLogin: actor, topology }) };
  const authority = {
    repositoryPath: root,
    guard: new DevelopmentRecordGuard(new MutationLockService(nodeFilesystem, nodeProcess), bound),
    trackingAuthority: { resolve: async () => ({ commonDirectory: root, actorLogin: actor, repository: topology.repository, head, base, expectedHeadSha: sha }) },
    credentials: { resolve: async () => ({ authorizationValue: token }) }, client: api,
  };
  const deliveryId = `fixture-${randomUUID().replaceAll("-", "")}`;
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
    if (pullRequest !== undefined) await api.request({ method: "PATCH", path: `/repos/${repository}/pulls/${pullRequest}`, body: { state: "closed" } });
    if (issue !== undefined) await api.request({ method: "PATCH", path: `/repos/${repository}/issues/${issue}`, body: { state: "closed" } });
    await rm(root, { recursive: true, force: true });
  }
});

function required(name: string): string { const value = process.env[name]; assert.ok(value, `${name} is required`); return value!; }
