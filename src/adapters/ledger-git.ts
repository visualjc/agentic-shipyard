import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { LedgerError } from "../ledger/errors.js";
import { applyLedgerTransaction, validLedgerPath } from "../ledger/transaction.js";
import type { GitObjectFormat, LedgerCommitChange, LedgerCommitInspection, LedgerInventory, LedgerInventoryReader, LedgerSnapshot, LedgerStore, LedgerTransaction, ObjectFormatAuthority } from "../ledger/types.js";
import type { PinnedLedgerReader } from "../context/types.js";
import { canonicalGitExecutable, DEFAULT_NODE_GIT_EXECUTABLE, sanitizedGitEnvironment } from "./git-transport.js";
import { redactGitTransportDiagnostic } from "../github/git-transport.js";

const MAX_INVENTORY_ENTRIES=4096,MAX_INVENTORY_PATH_BYTES=2_000_000,MAX_INVENTORY_ANCESTRY_BYTES=2_000_000,MAX_INVENTORY_RECORD_BYTES=1_000_000,MAX_INVENTORY_AGGREGATE_BYTES=2_000_000,MAX_INVENTORY_SMALL_OUTPUT_BYTES=16_384;

const execFileAsync = promisify(execFile);
type ProductCommitRef = Readonly<{ ref: string; commitSha: string }>;
export type GitLedgerStoreOptions = Readonly<{ gitExecutable?: string; commandTimeoutMs?: number; commandMaxOutputBytes?: number }>;
type CommandLimits = Readonly<{ timeoutMs: number; maxOutputBytes: number }>;
const MAX_COMMAND_TIMEOUT_MS = 30_000;
const MAX_COMMAND_OUTPUT_BYTES = 1_048_576;
const KILL_TEARDOWN_TIMEOUT_MS = 1_000;

/** Git object-database ledger that never checks its orphan ref out in a product worktree. */
export class GitLedgerStore implements LedgerStore, PinnedLedgerReader, LedgerInventoryReader, ObjectFormatAuthority {
  static readonly ref = "refs/heads/shipyard-ledger";
  /** The executable is resolved lazily so package import/construction is portable. */
  private readonly configuredGitExecutable: string;
  private readonly command: CommandLimits;
  constructor(private readonly repositoryPath: string, options: GitLedgerStoreOptions = {}) {
    // A historical untyped second string argument selected a ref. Accessing a
    // property on that value yields undefined, so old JavaScript callers still
    // cannot redirect the canonical ledger ref. Explicit injection is named.
    this.configuredGitExecutable = options?.gitExecutable ?? DEFAULT_NODE_GIT_EXECUTABLE;
    const timeoutMs = options.commandTimeoutMs ?? MAX_COMMAND_TIMEOUT_MS;
    const maxOutputBytes = options.commandMaxOutputBytes ?? MAX_COMMAND_OUTPUT_BYTES;
    if (![timeoutMs, maxOutputBytes].every(value => Number.isSafeInteger(value) && value > 0) || timeoutMs > MAX_COMMAND_TIMEOUT_MS || maxOutputBytes > MAX_COMMAND_OUTPUT_BYTES) throw new Error("Git ledger command limits must be positive safe integers at or below the fixed production ceilings.");
    this.command = { timeoutMs, maxOutputBytes };
  }

  async snapshot(paths: readonly string[]): Promise<LedgerSnapshot> {
    if (paths.some((path) => !validLedgerPath(path))) throw new LedgerError("ledger-invalid-path", "Ledger record paths must be relative, normalized paths.");
    const head = await this.optionalRef(GitLedgerStore.ref);
    if (head) await this.assertIsolatedHistory(head, head);
    const records: Record<string, string> = {};
    if (head) for (const path of paths) {
      const value = await this.optionalRecord(head, path);
      if (value !== undefined) records[path] = value;
    }
    if (head) await this.assertIsolatedHistory(head, head);
    return { head, records };
  }

  /** Inventories one safe prefix at the current ledger head and derives order only from linear commit ancestry. */
  async currentInventory(prefix:string):Promise<LedgerInventory>{
    if(typeof prefix!=="string"||!prefix.endsWith("/")||!validLedgerPath(`${prefix}record`))throw new LedgerError("ledger-invalid-path","Ledger inventory requires a normalized relative prefix.");
    const head=await this.optionalRef(GitLedgerStore.ref);if(!head)throw new LedgerError("ledger-unavailable","The configured ledger ref is unavailable.");
    await this.assertIsolatedHistory(head,head);
    const ancestry=await this.gitRequiredBounded(["rev-list","--first-parent","--reverse","--parents",head],MAX_INVENTORY_ANCESTRY_BYTES),ordinals=new Map<string,number>();
    for(const [index,line] of ancestry.split("\n").entries()){const fields=line.split(" ");if(fields.length>2||!fields[0]||index>=MAX_INVENTORY_ENTRIES)throw new LedgerError("ledger-invalid-record","Ledger inventory exceeds its bounded ancestry budget.");ordinals.set(fields[0],index+1);}
    const rawPaths=await this.gitRequiredBounded(["ls-tree","-r","-z","--name-only",head,"--",prefix],MAX_INVENTORY_PATH_BYTES),paths=rawPaths===""?[]:rawPaths.split("\0").filter(Boolean).sort();
    if(paths.length>MAX_INVENTORY_ENTRIES)throw new LedgerError("ledger-invalid-record","Ledger inventory exceeds its entry budget.");
    const entries=[];let aggregate=0;for(const path of paths){if(!path.startsWith(prefix)||!validLedgerPath(path))throw new LedgerError("ledger-invalid-record","Ledger inventory returned an unsafe path.");const commit=await this.gitRequiredBounded(["log","-1","--format=%H",head,"--",path],MAX_INVENTORY_SMALL_OUTPUT_BYTES),ordinal=ordinals.get(commit),contents=await this.optionalRecordBounded(head,path,MAX_INVENTORY_RECORD_BYTES);if(!ordinal||contents===undefined||(aggregate+=Buffer.byteLength(contents,"utf8"))>MAX_INVENTORY_AGGREGATE_BYTES)throw new LedgerError("ledger-invalid-record","Ledger inventory exceeds its record budget.");entries.push(Object.freeze({path,contents,ordinal}));}
    await this.assertIsolatedHistory(head,head);
    return Object.freeze({head,entries:Object.freeze(entries)});
  }

  /** Reads only the exact, existing ledger commit named by a context envelope. */
  async read(ledgerSha: string, paths: readonly string[]): Promise<Readonly<Record<string, string>>> {
    const objectFormat = await this.objectFormat();
    if (!fullObjectIdFor(objectFormat, ledgerSha) || paths.some((path) => !validLedgerPath(path))) {
      throw new LedgerError("ledger-invalid-path", "Pinned ledger reads require a full object ID and relative, normalized record paths.");
    }
    const head = await this.optionalRef(GitLedgerStore.ref);
    if (!head) throw new LedgerError("ledger-unavailable", "The configured ledger ref is unavailable.");
    await this.assertIsolatedHistory(head, head);
    const resolved = await this.optionalRef(`${ledgerSha}^{commit}`);
    if (!resolved) throw new LedgerError("ledger-unavailable", "The pinned ledger commit is unavailable.");
    if (resolved !== ledgerSha) throw new LedgerError("ledger-unavailable", "The pinned ledger commit did not resolve to its exact object ID.");
    if (!(await this.isAncestor(resolved, head))) {
      throw new LedgerError("ledger-unavailable", "The pinned ledger commit is not reachable from the configured ledger ref.");
    }
    const records: Record<string, string> = {};
    for (const path of paths) {
      const value = await this.optionalRecord(resolved, path);
      if (value !== undefined) records[path] = value;
    }
    await this.assertIsolatedHistory(head, head);
    return records;
  }

  /** Reads the exact reachable commit identity, sole parent, and tree diff needed by final-seal verification. */
  async inspectCommit(ledgerSha: string): Promise<LedgerCommitInspection> {
    if (!fullObjectIdFor(await this.objectFormat(), ledgerSha)) throw new LedgerError("ledger-invalid-path", "Ledger commit inspection requires a full object ID.");
    const head = await this.optionalRef(GitLedgerStore.ref);
    if (!head) throw new LedgerError("ledger-unavailable", "The configured ledger ref is unavailable.");
    await this.assertIsolatedHistory(head, head);
    const commitSha = await this.optionalRef(`${ledgerSha}^{commit}`);
    if (!commitSha) throw new LedgerError("ledger-unavailable", "The inspected ledger commit is unavailable.");
    if (commitSha !== ledgerSha) throw new LedgerError("ledger-unavailable", "The inspected ledger commit did not resolve to its exact object ID.");
    if (!(await this.isAncestor(commitSha, head))) throw new LedgerError("ledger-unavailable", "The inspected ledger commit is not reachable from the configured ledger ref.");
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
    await this.assertIsolatedHistory(head, head);
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
      await this.assertIsolatedHistory(commit, current.head);
      await this.updateRefCas(commit, current.head);
      try { await this.assertIsolatedHistory(commit, commit); }
      catch (error) {
        try { await this.restoreRefCas(commit, current.head); }
        catch (recoveryError) { throw new LedgerError("ledger-unavailable", `Ledger isolation recovery could not be proven; manual ref repair is required. Original failure: ${safeLedgerError(error)} Recovery failure: ${safeLedgerError(recoveryError)}`); }
        if (await this.optionalRef(GitLedgerStore.ref) !== current.head) throw new LedgerError("ledger-unavailable", `Ledger isolation recovery could not be proven; manual ref repair is required. Original failure: ${safeLedgerError(error)}`);
        throw error;
      }
      return commit;
    } finally { await rm(indexDirectory, { recursive: true, force: true }); }
  }

  /** A destination may stage product refs only; reject isolated or local-internal metadata refs. */
  static excludesRefspec(refspec: string): boolean {
    if (typeof refspec !== "string" || refspec.length === 0) return false;
    let normalized = refspec.startsWith("+") ? refspec.slice(1) : refspec;
    // Negative fetch refspecs transfer no ref themselves. They are exclusion clauses.
    if (normalized.startsWith("^")) return true;
    const separator = normalized.indexOf(":");
    const source = separator < 0 ? normalized : normalized.slice(0, separator);
    const destination = separator < 0 ? source : normalized.slice(separator + 1);
    if (!source || !destination) return false;
    return !protectedRefspecPattern(source, this.ref) && !protectedRefspecPattern(destination, this.ref);
  }

  /**
   * Mandatory fail-closed boundary for every future product-ref transport.
   * Issue #7 promotion code must call this before it hands refspecs or a
   * serialized transport payload to Git; no promotion caller exists yet.
   */
  static requireProductOnlyTransport(refspecs: readonly string[], payload?: string): void {
    if (!Array.isArray(refspecs) || refspecs.length === 0 || refspecs.some((refspec) => !this.excludesRefspec(refspec)) ||
      (payload !== undefined && (typeof payload !== "string" || payload.includes(this.ref) || payload.includes("refs/shipyard/")))) {
      throw new LedgerError("ledger-invalid-record", "Product transport must not carry isolated ledger or local Shipyard metadata refs.");
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

  private async optionalRecordBounded(head:string,path:string,maxBytes:number):Promise<string|undefined>{
    const probe=await this.run(["cat-file","-e",`${head}:${path}`]);if(probe.code!==0){if(missingTreePath(probe.stderr))return undefined;throw unavailable(probe.stderr);}
    return this.gitRequiredBounded(["show",`${head}:${path}`],maxBytes);
  }

  private async updateRefCas(commit: string, expectedHead: string | undefined): Promise<void> {
    const result = await this.run(["update-ref", GitLedgerStore.ref, commit, expectedHead ?? await this.nullObjectId()]);
    if (result.code === 0) return;
    if (staleRefUpdate(result.stderr)) throw new LedgerError("ledger-stale-head", "The ledger advanced; re-read its head before retrying.");
    throw unavailable(result.stderr);
  }

  private async restoreRefCas(candidate: string, previous: string | undefined): Promise<void> {
    const result = await this.run(previous === undefined ? ["update-ref", "-d", GitLedgerStore.ref, candidate] : ["update-ref", GitLedgerStore.ref, previous, candidate]);
    if (result.code !== 0) throw unavailable(result.stderr);
  }

  private async isAncestor(commit: string, head: string): Promise<boolean> {
    const result = await this.run(["merge-base", "--is-ancestor", commit, head]);
    if (result.code === 0) return true;
    if (result.code === 1) return false;
    throw unavailable(result.stderr);
  }

  private async hasCommonAncestor(left: string, right: string): Promise<boolean> {
    const result = await this.run(["merge-base", left, right]);
    if (result.code === 0) return true;
    if (result.code === 1) return false;
    throw unavailable(result.stderr);
  }

  /**
   * A ledger commit must share no ancestor with any supported product-ref
   * namespace. The ref inventory is checked twice so a
   * concurrent product-ref movement fails transiently rather than being
   * silently adopted; every public operation repeats this check.
   */
  private async assertIsolatedHistory(commitSha: string, expectedLedgerHead: string | undefined): Promise<void> {
    const before = await this.productCommitRefs();
    for (const product of before) {
      if (await this.hasCommonAncestor(commitSha, product.commitSha)) {
        throw new LedgerError("ledger-invalid-record", `The canonical ledger history overlaps product ref ${product.ref}; repair must be explicit.`);
      }
    }
    const after = await this.productCommitRefs();
    if (productRefSignature(before) !== productRefSignature(after)) throw new LedgerError("ledger-unavailable", "Product refs changed during ledger isolation validation; retry from a fresh snapshot.");
    if (await this.optionalRef(GitLedgerStore.ref) !== expectedLedgerHead) throw new LedgerError("ledger-stale-head", "The ledger advanced; re-read its head before retrying.");
  }

  /** Local heads (except the ledger), remote-tracking heads, and commit tags are product authority. */
  private async productCommitRefs(): Promise<readonly ProductCommitRef[]> {
    const output = await this.gitRequired([
      "for-each-ref",
      "--format=%(refname)%00%(objecttype)%00%(objectname)%00%(*objecttype)%00%(*objectname)",
      "refs/heads", "refs/remotes", "refs/tags",
    ]);
    if (output === "") return Object.freeze([]);
    const refs: ProductCommitRef[] = [];
    for (const line of output.split("\n")) {
      const [ref, objectType, objectName, peeledType, peeledName] = line.split("\0");
      if (!ref || ref === GitLedgerStore.ref) continue;
      const commitSha = objectType === "commit" ? objectName : peeledType === "commit" ? peeledName : undefined;
      if (!commitSha) {
        if (ref.startsWith("refs/heads/") || ref.startsWith("refs/remotes/")) throw new LedgerError("ledger-invalid-record", `Product ref ${ref} does not name a commit.`);
        continue; // A tag of a non-commit object is not a product-history authority.
      }
      if (!fullObjectIdFor(await this.objectFormat(), commitSha)) throw new LedgerError("ledger-invalid-record", `Product ref ${ref} has a non-canonical object ID.`);
      refs.push(Object.freeze({ ref, commitSha }));
    }
    refs.sort((left, right) => left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0);
    return Object.freeze(refs);
  }

  async objectFormat(): Promise<GitObjectFormat> {
    const format = await this.gitRequired(["rev-parse", "--show-object-format=storage"]);
    if (format === "sha1" || format === "sha256") return format;
    throw new LedgerError("ledger-unavailable", `Unsupported Git object format: ${format || "unknown"}.`);
  }

  private async nullObjectId(): Promise<string> { return "0".repeat((await this.objectFormat()) === "sha1" ? 40 : 64); }

  private async run(args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await execFileAsync(this.gitExecutable(), ["-C", this.repositoryPath, ...args], {
        encoding: "utf8", env: gitEnvironment(env), timeout: this.command.timeoutMs, maxBuffer: this.command.maxOutputBytes, killSignal: "SIGKILL",
      });
      return { code: 0, stdout, stderr };
    } catch (error: unknown) {
      const failure = error as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown };
      if (typeof failure.code !== "number") throw boundedLedgerFailure(error);
      return { code: failure.code, stdout: boundedOutput(failure.stdout, this.command.maxOutputBytes), stderr: boundedOutput(failure.stderr, this.command.maxOutputBytes) };
    }
  }
  private async gitRequired(args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    const result = await this.run(args, env);
    if (result.code !== 0) throw unavailable(result.stderr);
    return result.stdout.trim();
  }
  /** Streaming output bound for attacker-controlled ledger history/tree/content inventory. */
  private async gitRequiredBounded(args: string[], maxBytes: number): Promise<string> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new LedgerError("ledger-invalid-record", "Ledger inventory has an invalid output budget.");
    const outputLimit = Math.min(maxBytes, this.command.maxOutputBytes);
    return new Promise((resolve, reject) => {
      const child = spawn(this.gitExecutable(), ["-C", this.repositoryPath, ...args], {
        detached: process.platform !== "win32",
        env: gitEnvironment(),
      });
      let stdout = ""; let stderr = ""; let outputBytes = 0; let settled = false; let failure: LedgerError | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined; let teardownTimer: ReturnType<typeof setTimeout> | undefined;
      const settle = (code?: number | null) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (teardownTimer) clearTimeout(teardownTimer);
        if (failure) reject(failure);
        else if (code === 0) resolve(stdout.trim());
        else reject(unavailable(stderr));
      };
      const terminate = () => {
        let groupKilled = false;
        if (process.platform !== "win32" && child.pid !== undefined) {
          try { process.kill(-child.pid, "SIGKILL"); groupKilled = true; } catch { /* Fall back to the direct child handle. */ }
        }
        if (!groupKilled) child.kill("SIGKILL");
      };
      const fail = (error: LedgerError) => {
        if (settled || failure) return;
        failure = error;
        if (timer) clearTimeout(timer);
        terminate();
        // A failed inventory command is not reported until its process tree has
        // closed. The fallback remains bounded and explicitly reports that
        // teardown could not be proven instead of claiming a safe failure.
        teardownTimer = setTimeout(() => {
          if (settled) return;
          child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
          failure = new LedgerError("ledger-unavailable", "Git ledger inventory process teardown could not be proven.");
          settle();
        }, KILL_TEARDOWN_TIMEOUT_MS);
      };
      const collect = (target: "stdout" | "stderr", chunk: string) => {
        if (failure) return;
        outputBytes += Buffer.byteLength(chunk, "utf8");
        if (outputBytes > outputLimit) {
          fail(new LedgerError("ledger-invalid-record", "Ledger inventory child output exceeds its budget."));
          return;
        }
        if (target === "stdout") stdout += chunk; else stderr += chunk;
      };
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => collect("stdout", chunk));
      child.stderr.on("data", (chunk: string) => collect("stderr", chunk));
      child.once("error", () => fail(new LedgerError("ledger-unavailable", "Git ledger inventory process failed.")));
      child.once("close", (code) => { void (async () => {
        if (settled) return;
        if (teardownTimer) { clearTimeout(teardownTimer); teardownTimer = undefined; }
        terminate();
        const teardownComplete = await waitForLedgerProcessGroupExit(child.pid, KILL_TEARDOWN_TIMEOUT_MS);
        if (!teardownComplete) failure = new LedgerError("ledger-unavailable", "Git ledger inventory process teardown could not be proven.");
        settle(code);
      })(); });
      child.stdin.end();
      timer = setTimeout(() => fail(new LedgerError("ledger-unavailable", "Git ledger inventory process timed out and was killed.")), this.command.timeoutMs);
    });
  }
  private async gitInput(args: string[], input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.gitExecutable(), ["-C", this.repositoryPath, ...args], { env: gitEnvironment() });
      let stdout = ""; let stderr = ""; let outputBytes = 0; let finished = false; let settled = false; let failure: LedgerError | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined; let teardownTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (code?: number | null) => {
        if (settled) return; settled = true; finished = true;
        if (timer) clearTimeout(timer); if (teardownTimer) clearTimeout(teardownTimer);
        failure ? reject(failure) : code === 0 ? resolve(stdout.trim()) : reject(unavailable(stderr));
      };
      const fail = (error: LedgerError) => {
        failure ??= error;
        if (!finished && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        teardownTimer ??= setTimeout(() => finish(), KILL_TEARDOWN_TIMEOUT_MS);
      };
      const collect = (target: "stdout" | "stderr", chunk: string) => {
        outputBytes += Buffer.byteLength(chunk);
        if (target === "stdout") stdout = appendBoundedUtf8(stdout, chunk, this.command.maxOutputBytes);
        else stderr = appendBoundedUtf8(stderr, chunk, this.command.maxOutputBytes);
        if (outputBytes > this.command.maxOutputBytes) fail(new LedgerError("ledger-unavailable", "Git ledger operation exceeded its output limit and was killed."));
      };
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => collect("stdout", chunk)); child.stderr.on("data", (chunk: string) => collect("stderr", chunk));
      child.once("error", () => fail(new LedgerError("ledger-unavailable", "Git ledger operation could not be started.")));
      child.stdin.once("error", () => fail(new LedgerError("ledger-unavailable", "Git ledger operation input closed unexpectedly.")));
      timer = setTimeout(() => fail(new LedgerError("ledger-unavailable", "Git ledger operation timed out and was killed.")), this.command.timeoutMs);
      child.once("close", (code) => finish(code));
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

function unavailable(stderr: string): LedgerError { const safe = boundedDiagnostic(stderr); return new LedgerError("ledger-unavailable", `Git ledger operation failed${safe ? `: ${safe}` : ""}`); }
async function waitForLedgerProcessGroupExit(pid: number | undefined, timeoutMs: number): Promise<boolean> {
  if (!pid || process.platform === "win32") return true;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { process.kill(-pid, 0); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return true; }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function boundedOutput(value: unknown, limit: number): string { return typeof value === "string" ? truncateUtf8(value, limit) : ""; }
function boundedDiagnostic(value: string): string { return truncateUtf8(redactGitTransportDiagnostic(value).replace(/[^\x20-\x7e\n\t]/g, "?"), 512).trim(); }
function appendBoundedUtf8(current: string, chunk: string, limit: number): string { return truncateUtf8(current + chunk, limit); }
function truncateUtf8(value: string, limit: number): string {
  let bytes = 0; let end = 0;
  for (const character of value) { const size = Buffer.byteLength(character); if (bytes + size > limit) break; bytes += size; end += character.length; }
  return value.slice(0, end);
}
function boundedLedgerFailure(error: unknown): LedgerError {
  const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string; code?: unknown };
  const message = failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "Git ledger operation exceeded its output limit and was killed."
    : failure.killed || failure.signal ? "Git ledger operation timed out and was killed." : "Git ledger operation could not be started.";
  return new LedgerError("ledger-unavailable", message);
}
function safeLedgerError(error: unknown): string { return error instanceof LedgerError ? `${error.code}: ${boundedDiagnostic(error.message)}` : "unknown ledger failure"; }
function missingTreePath(stderr: string): boolean {
  return /path ['”]?.+['”]? does not exist in|exists on disk, but not in|not a valid object name/i.test(stderr);
}
function staleRefUpdate(stderr: string): boolean { return /cannot lock ref .+ is at .+ but expected/i.test(stderr); }
function productRefSignature(refs: readonly ProductCommitRef[]): string { return refs.map(({ ref, commitSha }) => `${ref}\0${commitSha}`).join("\n"); }
function refspecPatternMatches(pattern: string, ref: string): boolean {
  if (pattern.includes("..") || !pattern.startsWith("refs/")) return true;
  const stars = [...pattern].filter((character) => character === "*").length;
  if (stars > 1) return true; // invalid/unfamiliar patterns are unsafe to authorize.
  const expression = `^${pattern.split("*").map(escapeRegExp).join(".*")}$`;
  return new RegExp(expression).test(ref);
}

function protectedRefspecPattern(pattern: string, ledgerRef: string): boolean {
  return refspecPatternMatches(pattern, ledgerRef)
    || pattern.startsWith("refs/shipyard/")
    || refspecPatternMatches(pattern, "refs/shipyard/workspace-readiness/11111111-1111-4111-8111-111111111111")
    || refspecPatternMatches(pattern, "refs/shipyard/workspace-ownership/11111111-1111-4111-8111-111111111111");
}
function escapeRegExp(value: string): string { return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"); }
function fullObjectIdFor(format: GitObjectFormat, value: string): boolean { return new RegExp(`^[a-f0-9]{${format === "sha1" ? 40 : 64}}$`).test(value); }
