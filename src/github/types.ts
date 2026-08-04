export type GitHubRestMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type GitHubRestRequest = {
  method: GitHubRestMethod;
  path: string;
  body?: unknown;
};

/** API credentials are resolved per request and never persisted by Shipyard. */
export type GitHubApiCredential = { authorizationValue: string };

export interface GitHubApiCredentialResolver {
  resolve(): Promise<GitHubApiCredential | undefined>;
}

export type GitHubRestTransportRequest = GitHubRestRequest & {
  headers: Readonly<Record<string, string>>;
};

export type GitHubRestTransportResponse = {
  status: number;
  body?: unknown;
};

/** The network seam: tests inject a deterministic transport and production may use fetch. */
export interface GitHubRestTransport {
  request(request: GitHubRestTransportRequest): Promise<GitHubRestTransportResponse>;
}

/** A credential-scoped GitHub REST client; it never reads or changes gh identity. */
export interface GitHubRestClient {
  request<T>(request: GitHubRestRequest): Promise<T>;
}

/** Binds one resolved credential to the complete verified command session. */
export interface GitHubRestClientFactory {
  forCredential(credential: GitHubApiCredential): GitHubRestClient;
}

export type VerifiedGitHubSession = {
  actorLogin: string;
  request<T>(request: GitHubRestRequest): Promise<T>;
  write<T>(request: GitHubRestRequest): Promise<T>;
};
