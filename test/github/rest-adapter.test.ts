import assert from "node:assert/strict";
import test from "node:test";
import { GitHubRestAdapter } from "../../src/adapters/github-rest.js";
import { GitHubAuthorityError } from "../../src/github/errors.js";
import type { GitHubRestTransport } from "../../src/github/types.js";

const secret = "github_pat_secret-value";

test("sends the resolved API credential only as an ephemeral authorization header", async () => {
  const received: unknown[] = [];
  const transport: GitHubRestTransport = { request: async request => { received.push(request); return { status: 200, body: { login: "shipyard-actor" } }; } };
  const adapter = new GitHubRestAdapter({ resolve: async () => ({ authorizationValue: secret }) }, transport);

  const viewer = await adapter.request<{ login: string }>({ method: "GET", path: "/user" });
  assert.deepEqual(viewer, { login: "shipyard-actor" });
  assert.deepEqual(received, [{ method: "GET", path: "/user", headers: { accept: "application/vnd.github+json", authorization: `Bearer ${secret}` } }]);
});

test("maps REST permission failures to actionable safe errors", async () => {
  const adapter = new GitHubRestAdapter(
    { resolve: async () => ({ authorizationValue: secret }) },
    { request: async () => ({ status: 403, body: { message: `Forbidden: Bearer ${secret}` } }) },
  );

  await assert.rejects(
    adapter.request({ method: "POST", path: "/repos/acme/development/issues", body: { title: "record" } }),
    (error: unknown) => error instanceof GitHubAuthorityError && error.code === "permission-denied" && !error.message.includes(secret),
  );
});

test("redacts credentials from transport failures", async () => {
  const adapter = new GitHubRestAdapter(
    { resolve: async () => ({ authorizationValue: secret }) },
    { request: async () => { throw new Error(`network failure Authorization: Bearer ${secret}`); } },
  );

  await assert.rejects(
    adapter.request({ method: "GET", path: "/user" }),
    (error: unknown) => error instanceof GitHubAuthorityError && error.code === "transport-failure" && !error.message.includes(secret),
  );
});

test("redacts an opaque resolved credential from HTTP bodies and resolver failures", async t => {
  const opaqueSecret = "not-a-github-token";
  await t.test("HTTP body", async () => {
    const adapter = new GitHubRestAdapter(
      { resolve: async () => ({ authorizationValue: opaqueSecret }) },
      { request: async () => ({ status: 500, body: { message: `upstream leaked ${opaqueSecret}` } }) },
    );
    await assert.rejects(adapter.request({ method: "GET", path: "/user" }), error => error instanceof GitHubAuthorityError && !error.message.includes(opaqueSecret));
  });
  await t.test("resolver failure never surfaces resolver detail", async () => {
    const adapter = new GitHubRestAdapter(
      { resolve: async () => { throw new Error(`resolver leaked ${opaqueSecret}`); } },
      { request: async () => ({ status: 200 }) },
    );
    await assert.rejects(adapter.request({ method: "GET", path: "/user" }), error => error instanceof GitHubAuthorityError && !error.message.includes(opaqueSecret));
  });
});
