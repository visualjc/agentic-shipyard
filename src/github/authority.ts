import { GitHubAuthorityError } from "./errors.js";
import type { GitHubApiCredential, GitHubApiCredentialResolver, GitHubRestClient, GitHubRestClientFactory, GitHubRestRequest, GitHubTrackerSession, VerifiedGitHubSession } from "./types.js";

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
  const scopedClient = await verifiedClient(expectedActorLogin, credentials, client);
  return { actorLogin: expectedActorLogin, request: <T>(request: GitHubRestRequest & { method: "GET" }) => scopedClient.request<T>(request) };
}

async function verifiedClient(expectedActorLogin: string, credentials: GitHubApiCredentialResolver, client: GitHubRestClientFactory): Promise<GitHubRestClient> {
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

  return scopedClient;
}

/** Internal tracker capability: repository is fixed when actor verification occurs. */
export async function verifyTrackerActor(expected: string, repository: { owner: string; name: string }, credentials: GitHubApiCredentialResolver, client: GitHubRestClientFactory): Promise<GitHubTrackerSession> {
  const scoped = await verifiedClient(expected, credentials, client);
  const base = `/repos/${repository.owner}/${repository.name}`;
  return { request: <T>(request: GitHubRestRequest) => {
    const allowed = (request.method === "GET" && (request.path.startsWith(`${base}/issues?state=all&per_page=100&page=`) || request.path.startsWith(`${base}/pulls?state=all&per_page=100&page=`))) || (request.method === "POST" && (request.path === `${base}/issues` || request.path === `${base}/pulls`));
    if (!allowed) throw new GitHubAuthorityError("request-failed", "GitHub tracker request is outside the verified development-repository policy.");
    return scoped.request<T>(request);
  } };
}
