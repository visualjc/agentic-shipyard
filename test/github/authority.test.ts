import assert from "node:assert/strict";
import test from "node:test";
import { GitHubAuthorityError } from "../../src/github/errors.js";
import { verifyGitHubActor, verifyTrackerActor } from "../../src/github/authority.js";
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
  const session = await verifyTrackerActor("shipyard-actor", { owner: "acme", name: "development" }, credential(), client(async request => {
    calls.push(request);
    return request.path === "/user" ? { login: "shipyard-actor" } : { id: 42 };
  }));

  await session.request({ method: "POST", path: "/repos/acme/development/issues", body: { title: "Scoped record" } });
  assert.deepEqual(calls.map(({ method, path }) => [method, path]), [["GET", "/user"], ["POST", "/repos/acme/development/issues"]]);
});

test("tracker scope rejects destination and non-tracker mutations before transport", async () => {
  const calls: GitHubRestRequest[] = [];
  const scope = await verifyTrackerActor("shipyard-actor", { owner: "acme", name: "development" }, credential(), client(async request => { calls.push(request); return { login: "shipyard-actor" }; }));
  for (const request of [
    { method: "DELETE" as const, path: "/repos/acme/destination/issues/1" },
    { method: "PATCH" as const, path: "/repos/acme/development/issues/1" },
    { method: "POST" as const, path: "/repos/acme/destination/issues" },
  ]) await assert.rejects(Promise.resolve().then(() => scope.request(request)), { code: "request-failed" });
  assert.deepEqual(calls.map(call => call.path), ["/user"]);
});

test("tracker verification resolves one credential and one scoped client exactly once", async () => {
  let resolves = 0; let factories = 0; let viewers = 0;
  await verifyTrackerActor("actor", { owner: "acme", name: "development" }, { resolve: async () => { resolves += 1; return { authorizationValue: resolves === 1 ? "first" : "swapped" }; } }, { forCredential: credential => { factories += 1; assert.equal(credential.authorizationValue, "first"); return { request: async <T>(request: GitHubRestRequest) => { if (request.path === "/user") viewers += 1; return { login: "actor" } as T; } }; } });
  assert.deepEqual({ resolves, factories, viewers }, { resolves: 1, factories: 1, viewers: 1 });
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
