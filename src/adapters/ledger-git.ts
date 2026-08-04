import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { LedgerError } from "../ledger/errors.js";
import { applyLedgerTransaction, validLedgerPath } from "../ledger/transaction.js";
import type { LedgerCommitChange, LedgerCommitInspection, LedgerSnapshot, LedgerStore, LedgerTransaction } from "../ledger/types.js";
import type { PinnedLedgerReader } from "../context/types.js";
import { canonicalGitExecutable, DEFAULT_NODE_GIT_EXECUTABLE, sanitizedGitEnvironment } from "./git-transport.js";

const execFileAsync = promisify(execFile);
const zeroOid = "0".repeat(40);

/** Git object-database ledger that never checks its orphan ref out in a product worktree. */
export class GitLedgerStore implements LedgerStore, PinnedLedgerReader {
  static readonly ref = "refs/heads/shipyard-ledger";
  /** The executable is resolved lazily so package import/construction is portable. */
  private readonly configuredGitExecutable: string;
  constructor(private readonly repositoryPath: string, options?: Readonly<{ gitExecutable: string }>) {
    // A historical untyped second string argument selected a ref. Accessing a
    // property on that value yields undefined, so old JavaScript callers still
    // cannot redirect the canonical ledger ref. Explicit injection is named.
    this.configuredGitExecutable = options?.gitExecutable ?? DEFAULT_NODE_GIT_EXECUTABLE;
  }

  async snapshot(paths: readonly string[]): Promise<LedgerSnapshot> {
    if (paths.some((path) => !validLedgerPath(path))) throw new LedgerError("ledger-invalid-path", "Ledger record paths must be relative, normalized paths.");
    const head = await this.optionalRef(GitLedgerStore.ref);
    const records: Record<string, string> = {};
    if (head) for (const path of paths) {
      const value = await this.optionalRecord(head, path);
      if (value !== undefined) records[path] = value;
    }
    return { head, records };
  }

  /** Reads only the exact, existing ledger commit named by a context envelope. */
  async read(ledgerSha: string, paths: readonly string[]): Promise<Readonly<Record<string, string>>> {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ledgerSha) || paths.some((path) => !validLedgerPath(path))) {
      throw new LedgerError("ledger-invalid-path", "Pinned ledger reads require a full object ID and relative, normalized record paths.");
    }
    const resolved = await this.optionalRef(`${ledgerSha}^{commit}`);
    if (!resolved) throw new LedgerError("ledger-unavailable", "The pinned ledger commit is unavailable.");
    const head = await this.optionalRef(GitLedgerStore.ref);
    if (!head || !(await this.isAncestor(resolved, head))) {
      throw new LedgerError("ledger-unavailable", "The pinned ledger commit is not reachable from the configured ledger ref.");
    }
    const records: Record<string, string> = {};
    for (const path of paths) {
      const value = await this.optionalRecord(resolved, path);
      if (value !== undefined) records[path] = value;
    }
    return records;
  }

  /** Reads the exact reachable commit identity, sole parent, and tree diff needed by final-seal verification. */
  async inspectCommit(ledgerSha: string): Promise<LedgerCommitInspection> {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(ledgerSha)) throw new LedgerError("ledger-invalid-path", "Ledger commit inspection requires a full object ID.");
    const commitSha = await this.optionalRef(`${ledgerSha}^{commit}`);
    if (!commitSha) throw new LedgerError("ledger-unavailable", "The inspected ledger commit is unavailable.");
    const head = await this.optionalRef(GitLedgerStore.ref);
    if (!head || !(await this.isAncestor(commitSha, head))) throw new LedgerError("ledger-unavailable", "The inspected ledger commit is not reachable from the configured ledger ref.");
    const ancestry = (await this.gitRequired(["rev-list", "--parents", "-n", "1", commitSha])).split(" ");
    if (ancestry[0] !== commitSha || ancestry.length > 2) throw new LedgerError("ledger-invalid-record", "Ledger commits must have a single linear parent.");
    const parentSha = ancestry[1];
    const rawDiff = await this.gitRequired(["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "--no-renames", "-z", commitSha]);
    const fields = rawDiff === "" ? [] : rawDiff.split("\0");
    if (fields.at(-1) === "") fields.pop();
    if (fields.length % 2 !== 0) throw new LedgerError("ledger-invalid-record", "Ledger commit diff is malformed.");
    const changes: LedgerCommitChange[] = [];
    for (let index = 0; index < fields.length; index += 2) {
      const status = fields[index]!; const path = fields[index + 1]!;
      const mapped = status === "A" ? "added" : status === "M" ? "modified" : status === "D" ? "deleted" : undefined;
      if (!mapped || !validLedgerPath(path)) throw new LedgerError("ledger-invalid-record", "Ledger commit diff contains an unsupported change.");
      changes.push(Object.freeze({ status: mapped, path }));
    }
    return Object.freeze({ commitSha, parentSha, changes: Object.freeze(changes) });
  }

  async transact(transaction: LedgerTransaction): Promise<string> {
    const current = await this.snapshot(transaction.writes.map((write) => write.path));
    applyLedgerTransaction(current, transaction);
    const indexDirectory = await mkdtemp(join(tmpdir(), "shipyard-ledger-"));
    const indexFile = join(indexDirectory, "index");
    try {
      if (current.head) await this.gitRequired(["read-tree", current.head], { GIT_INDEX_FILE: indexFile });
      for (const write of transaction.writes) {
        const blob = await this.gitInput(["hash-object", "-w", "--stdin"], write.contents);
        await this.gitRequired(["update-index", "--add", "--cacheinfo", "100644", blob, write.path], { GIT_INDEX_FILE: indexFile });
      }
      const tree = await this.gitRequired(["write-tree"], { GIT_INDEX_FILE: indexFile });
      const commitArgs = current.head ? ["commit-tree", tree, "-p", current.head] : ["commit-tree", tree];
      const commit = await this.gitInput(commitArgs, transaction.message ?? "shipyard ledger checkpoint");
      await this.updateRefCas(commit, current.head);
      return commit;
    } finally { await rm(indexDirectory, { recursive: true, force: true }); }
  }

  /** A destination may stage product refs only; reject any refspec that can read or write the ledger ref. */
  static excludesRefspec(refspec: string): boolean {
    if (typeof refspec !== "string" || refspec.length === 0) return false;
    let normalized = refspec.startsWith("+") ? refspec.slice(1) : refspec;
    // Negative fetch refspecs transfer no ref themselves. They are exclusion clauses.
    if (normalized.startsWith("^")) return true;
    const separator = normalized.indexOf(":");
    const source = separator < 0 ? normalized : normalized.slice(0, separator);
    const destination = separator < 0 ? source : normalized.slice(separator + 1);
    if (!source || !destination) return false;
    return !refspecPatternMatches(source, this.ref) && !refspecPatternMatches(destination, this.ref);
  }

  /**
   * Mandatory fail-closed boundary for every future product-ref transport.
   * Issue #7 promotion code must call this before it hands refspecs or a
   * serialized transport payload to Git; no promotion caller exists yet.
   */
  static requireProductOnlyTransport(refspecs: readonly string[], payload?: string): void {
    if (!Array.isArray(refspecs) || refspecs.length === 0 || refspecs.some((refspec) => !this.excludesRefspec(refspec)) ||
      (payload !== undefined && (typeof payload !== "string" || payload.includes(this.ref)))) {
      throw new LedgerError("ledger-invalid-record", "Product transport must not carry the isolated ledger ref.");
    }
  }

  private async optionalRef(ref: string): Promise<string | undefined> {
    const result = await this.run(["rev-parse", "--verify", "--quiet", ref]);
    if (result.code === 0) return result.stdout.trim();
    if (result.code === 1) return undefined;
    throw unavailable(result.stderr);
  }

  /** Object/path absence is the only Git failure treated as a missing ledger record. */
  private async optionalRecord(head: string, path: string): Promise<string | undefined> {
    const probe = await this.run(["cat-file", "-e", `${head}:${path}`]);
    if (probe.code !== 0) {
      if (missingTreePath(probe.stderr)) return undefined;
      throw unavailable(probe.stderr);
    }
    const value = await this.run(["show", `${head}:${path}`]);
    if (value.code !== 0) throw unavailable(value.stderr);
    return value.stdout;
  }

  private async updateRefCas(commit: string, expectedHead: string | undefined): Promise<void> {
    const result = await this.run(["update-ref", GitLedgerStore.ref, commit, expectedHead ?? zeroOid]);
    if (result.code === 0) return;
    if (staleRefUpdate(result.stderr)) throw new LedgerError("ledger-stale-head", "The ledger advanced; re-read its head before retrying.");
    throw unavailable(result.stderr);
  }

  private async isAncestor(commit: string, head: string): Promise<boolean> {
    const result = await this.run(["merge-base", "--is-ancestor", commit, head]);
    if (result.code === 0) return true;
    if (result.code === 1) return false;
    throw unavailable(result.stderr);
  }

  private async run(args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await execFileAsync(this.gitExecutable(), ["-C", this.repositoryPath, ...args], {
        encoding: "utf8", env: gitEnvironment(env),
      });
      return { code: 0, stdout, stderr };
    } catch (error: unknown) {
      const failure = error as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown };
      if (typeof failure.code !== "number") throw new LedgerError("ledger-unavailable", `Git ledger operation failed: ${String(failure.message ?? error)}`);
      return { code: failure.code, stdout: typeof failure.stdout === "string" ? failure.stdout : "", stderr: typeof failure.stderr === "string" ? failure.stderr : "" };
    }
  }
  private async gitRequired(args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    const result = await this.run(args, env);
    if (result.code !== 0) throw unavailable(result.stderr);
    return result.stdout.trim();
  }
  private async gitInput(args: string[], input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.gitExecutable(), ["-C", this.repositoryPath, ...args], { env: gitEnvironment() });
      let stdout = ""; let stderr = "";
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; }); child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      child.on("error", reject); child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new LedgerError("ledger-unavailable", `Git ledger operation failed: ${stderr.trim()}`)));
      child.stdin.end(input);
    });
  }
  private gitExecutable(): string { return canonicalGitExecutable(this.configuredGitExecutable); }
}

/** Creates an isolated ledger store with an explicitly selected absolute Git executable. */
export function createGitLedgerStore(repositoryPath: string, executable = DEFAULT_NODE_GIT_EXECUTABLE): GitLedgerStore {
  return new GitLedgerStore(repositoryPath, { gitExecutable: executable });
}

/** Git repository selection must come only from the explicit -C argument. */
function gitEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return sanitizedGitEnvironment({ ...extra, GIT_AUTHOR_NAME: "shipyard", GIT_AUTHOR_EMAIL: "shipyard@local", GIT_COMMITTER_NAME: "shipyard", GIT_COMMITTER_EMAIL: "shipyard@local" });
}

function unavailable(stderr: string): LedgerError { return new LedgerError("ledger-unavailable", `Git ledger operation failed${stderr ? `: ${stderr.trim()}` : ""}`); }
function missingTreePath(stderr: string): boolean {
  return /path ['”]?.+['”]? does not exist in|exists on disk, but not in|not a valid object name/i.test(stderr);
}
function staleRefUpdate(stderr: string): boolean { return /cannot lock ref .+ is at .+ but expected/i.test(stderr); }
function refspecPatternMatches(pattern: string, ref: string): boolean {
  if (pattern.includes("..") || !pattern.startsWith("refs/")) return true;
  const stars = [...pattern].filter((character) => character === "*").length;
  if (stars > 1) return true; // invalid/unfamiliar patterns are unsafe to authorize.
  const expression = `^${pattern.split("*").map(escapeRegExp).join(".*")}$`;
  return new RegExp(expression).test(ref);
}
function escapeRegExp(value: string): string { return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"); }
