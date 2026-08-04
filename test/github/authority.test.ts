import assert from "node:assert/strict";
import test from "node:test";
import { GitHubAuthorityError } from "../../src/github/errors.js";
import { verifyGitHubActor } from "../../src/github/authority.js";
import type { GitHubApiCredentialResolver, GitHubRestClientFactory, GitHubRestRequest } from "../../src/github/types.js";

const secret = "ghp_this-must-never-be-disclosed";

function credential(value: string = secret): GitHubApiCredentialResolver {
  return { resolve: async () => value === undefined ? undefined : { authorizationValue: value } };
}

function client(handler: (request: GitHubRestRequest) => Promise<unknown>): GitHubRestClientFactory {
  return { forCredential: () => ({ request: async <T>(request: GitHubRestRequest) => handler(request) as Promise<T> }) };
}

test("verifies the configured actor before the first write", async () => {
  const calls: GitHubRestRequest[] = [];
  const session = await verifyGitHubActor("shipyard-actor", credential(), client(async request => {
    calls.push(request);
    return request.path === "/user" ? { login: "shipyard-actor" } : { id: 42 };
  }));

  await session.write({ method: "POST", path: "/repos/acme/development/issues", body: { title: "Scoped record" } });
  assert.deepEqual(calls.map(({ method, path }) => [method, path]), [["GET", "/user"], ["POST", "/repos/acme/development/issues"]]);
});

test("rejects an unexpected actor without a write", async () => {
  const calls: GitHubRestRequest[] = [];
  await assert.rejects(
    verifyGitHubActor("shipyard-actor", credential(), client(async request => {
      calls.push(request);
      return { login: "different-actor" };
    })),
    (error: unknown) => error instanceof GitHubAuthorityError && error.code === "actor-mismatch" && !error.message.includes(secret),
  );
  assert.deepEqual(calls.map(({ method, path }) => [method, path]), [["GET", "/user"]]);
});

test("rejects a missing credential without calling the REST client", async () => {
  let calls = 0;
  await assert.rejects(
    verifyGitHubActor("shipyard-actor", { resolve: async () => undefined }, client(async () => { calls += 1; return { login: "shipyard-actor" }; })),
    (error: unknown) => error instanceof GitHubAuthorityError && error.code === "authentication-required" && !error.message.includes(secret),
  );
  assert.equal(calls, 0);
});

test("denied viewer authentication makes zero writes and redacts credential material", async () => {
  const calls: GitHubRestRequest[] = [];
  await assert.rejects(
    verifyGitHubActor("shipyard-actor", credential(), client(async request => {
      calls.push(request);
      throw new Error(`HTTP 401 authorization Bearer ${secret}`);
    })),
    (error: unknown) => error instanceof GitHubAuthorityError && error.code === "authentication-denied" && !error.message.includes(secret),
  );
  assert.deepEqual(calls.map(({ method, path }) => [method, path]), [["GET", "/user"]]);
});

test("redacts opaque credentials from factory and verification failures", async t => {
  const opaqueSecret = "not-a-github-token";
  await t.test("factory", async () => {
    await assert.rejects(
      verifyGitHubActor("shipyard-actor", credential(opaqueSecret), { forCredential: () => { throw new Error(`factory leaked ${opaqueSecret}`); } }),
      error => error instanceof GitHubAuthorityError && !error.message.includes(opaqueSecret),
    );
  });
  await t.test("verification", async () => {
    await assert.rejects(
      verifyGitHubActor("shipyard-actor", credential(opaqueSecret), client(async () => { throw new Error(`verification leaked ${opaqueSecret}`); })),
      error => error instanceof GitHubAuthorityError && !error.message.includes(opaqueSecret),
    );
  });
});
