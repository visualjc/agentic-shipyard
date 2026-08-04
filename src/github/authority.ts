import { GitHubAuthorityError } from "./errors.js";
import type { GitHubApiCredential, GitHubApiCredentialResolver, GitHubRestClient, GitHubRestClientFactory, GitHubRestRequest, VerifiedGitHubSession } from "./types.js";

type GitHubViewer = { login?: unknown };

/**
 * Establishes a command-scoped actor session. Viewer verification completes
 * before this function returns, so a caller cannot issue a write first.
 */
export async function verifyGitHubActor(
  expectedActorLogin: string,
  credentials: GitHubApiCredentialResolver,
  client: GitHubRestClientFactory,
): Promise<VerifiedGitHubSession> {
  let credential: GitHubApiCredential | undefined;
  try {
    credential = await credentials.resolve();
  } catch {
    // Resolver errors can carry opaque provider credentials, so keep the detail private.
    throw new GitHubAuthorityError("authentication-required", "GitHub API credential resolution failed.");
  }
  if (!credential?.authorizationValue) {
    throw new GitHubAuthorityError("authentication-required", "GitHub API credentials are required to verify the configured actor.");
  }
  let scopedClient: GitHubRestClient;
  try {
    scopedClient = client.forCredential(credential);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new GitHubAuthorityError("authentication-denied", `GitHub actor verification setup failed: ${detail}`, [credential.authorizationValue]);
  }

  let viewer: GitHubViewer;
  try {
    viewer = await scopedClient.request<GitHubViewer>({ method: "GET", path: "/user" });
  } catch (error: unknown) {
    if (error instanceof GitHubAuthorityError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new GitHubAuthorityError("authentication-denied", `GitHub actor verification failed: ${detail}`, [credential.authorizationValue]);
  }
  if (typeof viewer.login !== "string" || viewer.login !== expectedActorLogin) {
    throw new GitHubAuthorityError("actor-mismatch", "GitHub authenticated actor does not match the configured profile actor.");
  }

  return {
    actorLogin: expectedActorLogin,
    request: <T>(request: GitHubRestRequest) => scopedClient.request<T>(request),
    write: <T>(request: GitHubRestRequest) => {
      if (request.method === "GET") throw new GitHubAuthorityError("request-failed", "GitHub writes must use a mutation method.");
      return scopedClient.request<T>(request);
    },
  };
}
