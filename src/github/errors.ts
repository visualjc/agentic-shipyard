export type GitHubAuthorityErrorCode =
  | "authentication-required"
  | "authentication-denied"
  | "actor-mismatch"
  | "permission-denied"
  | "request-failed"
  | "transport-failure";

/** Remove credential-like strings before they can reach a caller's diagnostic surface. */
export function redactGitHubCredential(value: string, secretValues: readonly string[] = []): string {
  let redacted = value;
  for (const secret of secretValues) {
    if (secret) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?\S+/gi, "$1[REDACTED]")
    .replace(/\bbearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_\-]+|github_pat_[A-Za-z0-9_\-]+)\b/g, "[REDACTED]");
}

/** A stable, display-safe error for GitHub API authority failures. */
export class GitHubAuthorityError extends Error {
  readonly name = "GitHubAuthorityError";

  constructor(readonly code: GitHubAuthorityErrorCode, message: string, secretValues: readonly string[] = []) {
    super(redactGitHubCredential(message, secretValues));
  }
}
