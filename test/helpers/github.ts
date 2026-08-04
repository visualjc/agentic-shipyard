import type { GitHubRestRequest, VerifiedGitHubSession } from "../../src/github/types.js";

/** Deterministic REST/session seam for tracker tests; it never touches GitHub. */
export class FakeVerifiedGitHubSession implements VerifiedGitHubSession {
  readonly requests: GitHubRestRequest[] = [];
  readonly writes: GitHubRestRequest[] = [];

  constructor(
    readonly actorLogin: string,
    private readonly respond: (request: GitHubRestRequest) => unknown | Promise<unknown>,
  ) {}

  async request<T>(request: GitHubRestRequest): Promise<T> {
    this.requests.push(request);
    return this.respond(request) as Promise<T>;
  }

  async write<T>(request: GitHubRestRequest): Promise<T> {
    this.writes.push(request);
    return this.respond(request) as Promise<T>;
  }
}
