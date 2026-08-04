import { GitHubAuthorityError, redactGitHubCredential } from "../github/errors.js";
import type { GitHubApiCredential, GitHubApiCredentialResolver, GitHubRestClient, GitHubRestClientFactory, GitHubRestRequest, GitHubRestTransport } from "../github/types.js";

/** Production fetch transport; default tests inject fakes and never call it. */
export class FetchGitHubRestTransport implements GitHubRestTransport {
  constructor(private readonly baseUrl = "https://api.github.com") {}
  async request(request: import("../github/types.js").GitHubRestTransportRequest) {
    const headers = request.body === undefined ? request.headers : { ...request.headers, "content-type": "application/json" };
    const response = await fetch(`${this.baseUrl}${request.path}`, { method: request.method, headers, body: request.body === undefined ? undefined : JSON.stringify(request.body) });
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    return { status: response.status, body };
  }
}

/** Credential-scoped REST adapter. It deliberately has no dependency on the gh CLI. */
export class GitHubRestAdapter implements GitHubRestClient, GitHubRestClientFactory {
  constructor(
    private readonly credentials: GitHubApiCredentialResolver,
    private readonly transport: GitHubRestTransport,
  ) {}

  async request<T>(request: GitHubRestRequest): Promise<T> {
    let credential: GitHubApiCredential | undefined;
    try {
      credential = await this.credentials.resolve();
    } catch {
      // A resolver may include opaque secret material in its own error. Do not expose it.
      throw new GitHubAuthorityError("authentication-required", "GitHub API credential resolution failed.");
    }
    if (!credential?.authorizationValue) {
      throw new GitHubAuthorityError("authentication-required", "GitHub API credentials are required for this operation.");
    }

    return this.requestWithCredential<T>(credential, request);
  }

  forCredential(credential: GitHubApiCredential): GitHubRestClient {
    return { request: <T>(request: GitHubRestRequest) => this.requestWithCredential<T>(credential, request) };
  }

  private async requestWithCredential<T>(credential: GitHubApiCredential, request: GitHubRestRequest): Promise<T> {
    try {
      const response = await this.transport.request({
        ...request,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${credential.authorizationValue}`,
        },
      });
      if (response.status >= 200 && response.status < 300) return response.body as T;
      const detail = response.body && typeof response.body === "object" && "message" in response.body
        ? String(response.body.message) : `HTTP ${response.status}`;
      if (response.status === 401) throw new GitHubAuthorityError("authentication-denied", `GitHub authentication was denied: ${detail}`, [credential.authorizationValue]);
      if (response.status === 403) throw new GitHubAuthorityError("permission-denied", `GitHub permission was denied: ${detail}`, [credential.authorizationValue]);
      throw new GitHubAuthorityError("request-failed", `GitHub REST request failed (${response.status}): ${detail}`, [credential.authorizationValue]);
    } catch (error: unknown) {
      if (error instanceof GitHubAuthorityError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new GitHubAuthorityError("transport-failure", `GitHub REST transport failed: ${redactGitHubCredential(detail, [credential.authorizationValue])}`, [credential.authorizationValue]);
    }
  }
}
