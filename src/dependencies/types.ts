export type DependencyId = "matt-skills" | "ccpm" | "codex" | "claude-code" | "cursor-pstack" | "planning-host";
export type DependencyState = "ready" | "missing" | "modified" | "duplicate" | "incompatible" | "unverified" | "not-required";
export type CapabilityHost = "codex" | "claude-code" | "cursor-pstack";
export type CapabilityLane = "large" | "small" | "bug" | "review-only";

/** Provenance, installed bytes, and runtime compatibility are intentionally distinct facts. */
export type SourceReceipt = Readonly<{ kind: "git-commit"; repository: string; commit: string }>;
export type MattSkillTreeReceipt = Readonly<{ name: string; sourcePath: string; treeSha: string; requiredFiles: readonly string[] }>;
export type ContentReceipt =
  | Readonly<{ kind: "matt-skill-trees"; skills: readonly MattSkillTreeReceipt[] }>
  | Readonly<{ kind: "git-tree"; subpath: string; treeSha: string; requiredFiles: readonly string[] }>
  | Readonly<{ kind: "none" }>;
export type RuntimeReceipt = Readonly<{ kind: "runtime-version"; host: CapabilityHost; version: string }>;
export type InvocationMetadata = Readonly<{ command: string; frontmatterName: string; requiredFiles: readonly string[] }>;
export type CapabilityDependency = Readonly<{
  id: DependencyId;
  source?: SourceReceipt;
  content: ContentReceipt;
  runtime?: RuntimeReceipt;
  hosts: readonly CapabilityHost[];
  lanes: readonly CapabilityLane[];
  invocation: InvocationMetadata;
  canonicalDiscovery: readonly string[];
}>;
export type CapabilityManifest = Readonly<{ schemaVersion: 1; dependencies: readonly CapabilityDependency[] }>;
export type ObservedDependencyReceipt = Readonly<{
  id: DependencyId;
  source?: SourceReceipt;
  content?: ContentReceipt;
  discoveryPaths: readonly string[];
  invocation?: Readonly<{ command?: string; frontmatterName?: string }>;
  skillMetadata?: readonly Readonly<{ name: string; frontmatterName: string; files: readonly string[] }>[];
  runtimes: readonly RuntimeReceipt[];
}>;
export type DependencyFinding = Readonly<{ dependency: DependencyId; state: DependencyState; remediation: string }>;
export type DependencyStatus = Readonly<{ schemaVersion: 1; findings: readonly DependencyFinding[]; ready: boolean; nextSafeAction: string }>;
