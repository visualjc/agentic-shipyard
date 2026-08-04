export type PathOwner = "product" | "development-record" | "development-generated" | "destination-only" | "context-overlay" | "scratch";

export interface PathRule { owner: PathOwner; pattern: string; }
export interface PathPolicy { version: 1; rules: PathRule[]; }
export class PathPolicyError extends Error {
  readonly name = "PathPolicyError";
  constructor(readonly code: "unclassified-path" | "conflicting-path-ownership" | "invalid-path", message: string) { super(message); }
}

/** Returns the sole owner. Later sync/promotion/finalization code must all call this function. */
export function classifyPath(policy: PathPolicy, path: string): PathOwner {
  if (!path || path.startsWith("/") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new PathPolicyError("invalid-path", `Path is not a normalized repository-relative path: ${path}`);
  }
  const matches = policy.rules.filter((rule) => matchesGlob(rule.pattern, path));
  if (matches.length === 0) throw new PathPolicyError("unclassified-path", `No policy owner classifies ${path}.`);
  const owners = [...new Set(matches.map((rule) => rule.owner))];
  if (owners.length !== 1) throw new PathPolicyError("conflicting-path-ownership", `Conflicting policy owners classify ${path}: ${owners.join(", ")}.`);
  return owners[0];
}

export function classifyPaths(policy: PathPolicy, paths: readonly string[]): Map<string, PathOwner> {
  return new Map(paths.map((path) => [path, classifyPath(policy, path)]));
}

function matchesGlob(pattern: string, path: string): boolean {
  const expression = `^${pattern.split("**").map((part) => part.split("*").map(escapeRegExp).join("[^/]*")).join(".*")}$`;
  return new RegExp(expression).test(path);
}
function escapeRegExp(value: string): string { return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"); }
