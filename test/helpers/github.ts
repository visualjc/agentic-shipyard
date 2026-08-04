import type { GitHubRestRequest, VerifiedGitHubSession } from "../../src/github/types.js";

/** Deterministic REST/session seam for tracker tests; it never touches GitHub. */
export class FakeVerifiedGitHubSession implements VerifiedGitHubSession {
  readonly requests: GitHubRestRequest[] = [];

  constructor(
    readonly actorLogin: string,
    private readonly respond: (request: GitHubRestRequest) => unknown | Promise<unknown>,
  ) {}

  async request<T>(request: GitHubRestRequest & { method: "GET" }): Promise<T> {
    this.requests.push(request);
    return this.respond(request) as Promise<T>;
  }

  tracker(): { request<T>(request: GitHubRestRequest): Promise<T> } {
    return { request: (request) => { this.requests.push(request); return this.respond(request) as Promise<never>; } };
  }

}
