import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { FetchGitHubRestTransport, GitHubRestAdapter } from "../../src/index.js";

const enabled = process.env.SHIPYARD_PRIVATE_GITHUB_FIXTURE === "1";

test("private synthetic GitHub fixture creates and closes only its approved marked issue", { skip: !enabled }, async () => {
  const repository = process.env.SHIPYARD_PRIVATE_GITHUB_REPOSITORY;
  const token = process.env.SHIPYARD_PRIVATE_GITHUB_TOKEN;
  const actor = process.env.SHIPYARD_PRIVATE_GITHUB_ACTOR;
  assert.match(repository ?? "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  assert.ok(token); assert.match(actor ?? "", /^[A-Za-z0-9-]+$/);
  const approvedRepository = repository!;
  assert.notEqual(approvedRepository, "NativeInteractive");
  assert.ok(!approvedRepository.startsWith("NativeInteractive/"));
  const api = new GitHubRestAdapter({ resolve: async () => ({ authorizationValue: token! }) }, new FetchGitHubRestTransport());
  const viewer = await api.request<{ login: string }>({ method: "GET", path: "/user" });
  assert.equal(viewer.login, actor);
  const marker = `<!-- shipyard:private-fixture:${randomUUID()} -->`;
  let number: number | undefined;
  try {
    const issue = await api.request<{ number: number; html_url: string; repository_url?: string }>({ method: "POST", path: `/repos/${approvedRepository}/issues`, body: { title: "Shipyard private fixture", body: marker } });
    number = issue.number;
    const issueUrl = new URL(issue.html_url);
    assert.equal(issueUrl.hostname, "github.com");
    assert.equal(issueUrl.pathname, `/${approvedRepository}/issues/${issue.number}`);
    assert.ok(Number.isInteger(issue.number) && issue.number > 0);
    assert.equal(issue.repository_url, `https://api.github.com/repos/${approvedRepository}`);
  } finally {
    if (number !== undefined) await api.request({ method: "PATCH", path: `/repos/${approvedRepository}/issues/${number}`, body: { state: "closed" } });
  }
});
