import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { canonicalGitExecutable, DEFAULT_NODE_GIT_EXECUTABLE, sanitizedGitEnvironment } from "./git-transport.js";
import { redactGitTransportDiagnostic } from "../github/git-transport.js";
import type { BaselineObservation, SyncGit, SyncMutationProof, UnderLockMainFastForwardProof, UnderLockMainSyncGit } from "../sync/git.js";

const exec = promisify(execFile);
export type NodeSyncGitOptions = Readonly<{
  transactionTimeoutMs?: number;
  transactionMaxOutputBytes?: number;
  transactionSpawner?: typeof spawn;
  commandTimeoutMs?: number;
  commandMaxOutputBytes?: number;
}>;
type TransactionLimits = Readonly<{ transactionTimeoutMs: number; transactionMaxOutputBytes: number; transactionSpawner?: typeof spawn }>;

/** Local Git mutation adapter. It has no push/rebase/reset or merge-commit capability. */
export class NodeSyncGit implements SyncGit, UnderLockMainSyncGit {
  private readonly executable: string;
  private readonly transaction: TransactionLimits;
  private readonly command: Readonly<{ timeoutMs: number; maxOutputBytes: number }>;
  constructor(executable = DEFAULT_NODE_GIT_EXECUTABLE, options: NodeSyncGitOptions = {}) {
    this.executable = canonicalGitExecutable(executable);
    const transactionTimeoutMs = options.transactionTimeoutMs ?? 30_000;
    const transactionMaxOutputBytes = options.transactionMaxOutputBytes ?? 16_384;
    const commandTimeoutMs = options.commandTimeoutMs ?? 30_000;
    const commandMaxOutputBytes = options.commandMaxOutputBytes ?? 1_048_576;
    if (![transactionTimeoutMs, transactionMaxOutputBytes, commandTimeoutMs, commandMaxOutputBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("Git command limits must be positive safe integers.");
    this.transaction = { transactionTimeoutMs, transactionMaxOutputBytes, transactionSpawner: options.transactionSpawner };
    this.command = { timeoutMs: commandTimeoutMs, maxOutputBytes: commandMaxOutputBytes };
  }
  async observe(repo: string, remote: string, developmentBranch: string, destinationBranch: string): Promise<BaselineObservation> {
    const [dirty, branch, developmentSha, destinationSha, remoteUrl, format] = await Promise.all([
      this.required(repo, ["status", "--porcelain"]), this.required(repo, ["symbolic-ref", "--short", "HEAD"]),
      this.required(repo, ["rev-parse", `refs/heads/${developmentBranch}`]), this.required(repo, ["rev-parse", `refs/remotes/${remote}/${destinationBranch}`]),
      this.required(repo, ["remote", "get-url", remote]), this.required(repo, ["rev-parse", "--show-object-format"]),
    ]);
    const ancestry = developmentSha === destinationSha ? "equal" : await this.ancestor(repo, developmentSha, destinationSha) ? "behind" : await this.ancestor(repo, destinationSha, developmentSha) ? "ahead" : "diverged";
    const paths = (await this.required(repo, ["diff", "--name-only", developmentSha, destinationSha])).split("\n").filter(Boolean);
    if (format !== "sha1" && format !== "sha256") throw new Error("Unsupported Git object format.");
    return { clean: dirty === "", checkedOutBranch: branch, developmentSha, destinationSha, ancestry, remoteUrl: remoteUrl || undefined, changedPaths: paths, objectFormat: format };
  }
  async observeStaged(repo: string, staged: string, remote: string, developmentBranch: string): Promise<BaselineObservation> {
    const [dirty, branch, developmentSha, destinationSha, remoteUrl, format, stagedFormat] = await Promise.all([
      this.required(repo, ["status", "--porcelain"]), this.required(repo, ["symbolic-ref", "--short", "HEAD"]), this.required(repo, ["rev-parse", `refs/heads/${developmentBranch}`]),
      this.required(staged, ["rev-parse", "refs/shipyard/staged-destination"]), this.required(repo, ["remote", "get-url", remote]), this.required(repo, ["rev-parse", "--show-object-format"]), this.required(staged, ["rev-parse", "--show-object-format"]),
    ]);
    if (format !== stagedFormat || format !== "sha1" && format !== "sha256") throw new Error("Staged and product Git object formats differ.");
    const stagedDevelopment = await this.required(staged, ["rev-parse", "refs/shipyard/staged-development"]); if (stagedDevelopment !== developmentSha) throw new Error("Development main changed while staging destination facts.");
    const ancestry = developmentSha === destinationSha ? "equal" : await this.ancestor(staged, developmentSha, destinationSha) ? "behind" : await this.ancestor(staged, destinationSha, developmentSha) ? "ahead" : "diverged";
    const paths = (await this.required(staged, ["diff", "--name-only", developmentSha, destinationSha])).split("\n").filter(Boolean);
    return { clean: dirty === "", checkedOutBranch: branch, developmentSha, destinationSha, ancestry, remoteUrl, changedPaths: paths, objectFormat: format };
  }
  async materializeStaged(repo: string, staged: string, stagedRef: string, expectedSha: string, proof: SyncMutationProof): Promise<void> {
    if (stagedRef !== "refs/shipyard/staged-destination") throw new Error("Staged destination ref is not canonical; no mutation was permitted.");
    await this.assertMutationProof(repo, proof);
    await this.assertStagedProof(staged, proof, stagedRef, expectedSha, "commit");
    await this.required(repo, ["fetch", "--no-tags", "--no-write-fetch-head", staged, stagedRef]);
    if (await this.required(repo, ["rev-parse", "--verify", `${expectedSha}^{commit}`]) !== expectedSha) throw new Error("Staged object materialization did not preserve its exact object ID.");
  }
  async fastForward(repo: string, destination: string, proof: SyncMutationProof): Promise<void> {
    if (destination !== proof.expectedDestinationTrackingSha) throw new Error("Fast-forward destination does not match the mutation proof; no mutation was permitted.");
    await this.assertMutationProof(repo, proof);
    const { destinationRemote: remote, developmentBranch: branch, destinationBranch, expectedDevelopmentSha: expected, expectedDestinationTrackingSha: trackingBefore } = proof;
    if (!await this.ancestor(repo, expected, destination)) throw new Error("Fast-forward ancestry changed; no ref was updated.");
    const trackingRef = `refs/remotes/${remote}/${destinationBranch}`;
    const transaction = await prepareRefTransaction(this.executable, repo, [{ ref: `refs/heads/${branch}`, next: destination, previous: expected }, { ref: trackingRef, next: destination, previous: trackingBefore }], this.transaction);
    let applied = false;
    try {
      await this.assertMutationProof(repo, proof); await this.required(repo, ["read-tree", "-u", "-m", expected, destination]); applied = true;
      await this.assertPostReadTreeProof(repo, destination, proof); await transaction.commit(); await this.assertCommittedProof(repo, destination, proof);
    }
    catch (error) {
      await transaction.abort();
      try { await this.restoreFastForwardRefs(repo, branch, trackingRef, expected, trackingBefore, destination); }
      catch (recoveryError) { throw new Error("Fast-forward ref recovery could not be proven; inspect main and destination tracking refs manually before any retry.", { cause: new AggregateError([error, recoveryError]) }); }
      if (applied && await this.treeAndWorktreeEqual(repo, destination) && await this.required(repo, ["ls-files", "--others", "--exclude-standard"]) === "") await this.required(repo, ["read-tree", "-u", "-m", destination, expected]);
      throw error;
    }
  }
  async fastForwardMainUnderLock(repo:string,proof:UnderLockMainFastForwardProof):Promise<void>{const ref=`refs/heads/${proof.developmentBranch}`,[dirty,branch,current,format]=await Promise.all([this.required(repo,["status","--porcelain"]),this.required(repo,["symbolic-ref","--short","HEAD"]),this.required(repo,["rev-parse",ref]),this.required(repo,["rev-parse","--show-object-format"])]);if(current===proof.targetDestinationSha){if(dirty!==""||branch!==proof.developmentBranch||format!==proof.objectFormat)throw new Error("Finalization main already advanced but its checked-out worktree proof is unsafe.");return;}if(dirty!==""||branch!==proof.developmentBranch||current!==proof.expectedDevelopmentSha||format!==proof.objectFormat||!await this.ancestor(repo,current,proof.targetDestinationSha))throw new Error("Under-lock main fast-forward proof changed; no mutation was permitted.");let treeApplied=false;try{await this.required(repo,["read-tree","-u","-m",current,proof.targetDestinationSha]);treeApplied=true;await this.required(repo,["update-ref",ref,proof.targetDestinationSha,current]);const [after,afterDirty]=await Promise.all([this.required(repo,["rev-parse",ref]),this.required(repo,["status","--porcelain"])]);if(after!==proof.targetDestinationSha||afterDirty!=="")throw new Error("Under-lock main fast-forward verification failed.");}catch(error){const now=await this.optional(repo,ref);if(now===current&&treeApplied)await this.required(repo,["read-tree","-u","-m",proof.targetDestinationSha,current]);throw error;}}
  async importStaged(repo: string, staged: string, stagedRef: string, localRef: string, expectedSha: string, proof: SyncMutationProof): Promise<string> {
    const sourcePrefix = `refs/shipyard/source/${proof.destinationRemote}/`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(proof.destinationRemote) || stagedRef !== "refs/shipyard/staged-source" || !localRef.startsWith(sourcePrefix) || !/^[a-f0-9]{64}$/.test(localRef.slice(sourcePrefix.length))) throw new Error("Staged source import refs are not canonical; no mutation was permitted.");
    await this.assertMutationProof(repo, proof);
    await this.assertStagedProof(staged, proof, stagedRef, expectedSha, "object");
    await this.required(repo, ["fetch", "--no-tags", "--no-write-fetch-head", staged, stagedRef]);
    const resolved = await this.required(repo, ["rev-parse", "--verify", `${expectedSha}^{object}`]); if (resolved !== expectedSha) throw new Error("Staged import did not resolve to its expected exact object.");
    await this.assertMutationProof(repo, proof);
    await this.assertStagedProof(staged, proof, stagedRef, expectedSha, "object");
    const current = await this.optional(repo, localRef); if (current !== undefined && current !== resolved) throw new Error("Existing source ref differs; policy-read-only source refs are never overwritten.");
    if (current !== resolved) await this.required(repo, ["update-ref", localRef, resolved, current ?? await this.nullObject(repo)]);
    return resolved;
  }
  async resolveSource(repo: string, remote: string, source: string): Promise<string> {
    const value = await this.required(repo, ["ls-remote", remote, source]); const lines = value.split("\n").filter(Boolean); if (lines.length !== 1) throw new Error("Named source ref must resolve to exactly one destination ref."); const sha = lines[0]!.split(/\s+/)[0]; if (!sha) throw new Error("Named source ref did not resolve."); return sha;
  }
  resolveLocal(repo: string, localRef: string): Promise<string> { return this.required(repo, ["rev-parse", localRef]); }
  resolveLocalOptional(repo: string, localRef: string): Promise<string | undefined> { return this.optional(repo, localRef); }
  private async ancestor(repo: string, left: string, right: string): Promise<boolean> { try { await this.required(repo, ["merge-base", "--is-ancestor", left, right]); return true; } catch { return false; } }
  private async optional(repo: string, ref: string): Promise<string | undefined> {
    try { return await this.required(repo, ["rev-parse", "--verify", "--quiet", ref]); }
    catch (error) { if ((error as NodeJS.ErrnoException & { code?: number }).code === 1) return undefined; throw error; }
  }
  private async nullObject(repo: string): Promise<string> { const format = await this.required(repo, ["rev-parse", "--show-object-format"]); return "0".repeat(format === "sha256" ? 64 : 40); }
  private async assertMutationProof(repo: string, proof: SyncMutationProof): Promise<void> {
    const [dirty, branch, development, tracking, remoteUrl, objectFormat] = await Promise.all([
      this.required(repo, ["status", "--porcelain"]),
      this.required(repo, ["symbolic-ref", "--short", "HEAD"]),
      this.required(repo, ["rev-parse", `refs/heads/${proof.developmentBranch}`]),
      this.required(repo, ["rev-parse", `refs/remotes/${proof.destinationRemote}/${proof.destinationBranch}`]),
      this.required(repo, ["remote", "get-url", proof.destinationRemote]),
      this.required(repo, ["rev-parse", "--show-object-format"]),
    ]);
    if (dirty !== "" || branch !== proof.developmentBranch || development !== proof.expectedDevelopmentSha || tracking !== proof.expectedDestinationTrackingSha || remoteUrl !== proof.expectedRemoteUrl || objectFormat !== proof.objectFormat) throw new Error("Local Git mutation proof changed; no mutation was permitted.");
  }
  /** read-tree intentionally makes HEAD appear behind its index; validate the equivalent clean destination state instead. */
  private async assertPostReadTreeProof(repo: string, destination: string, proof: SyncMutationProof): Promise<void> {
    const [worktreeClean, indexMatchesDestination, untracked, branch, development, tracking, remoteUrl, objectFormat] = await Promise.all([
      this.noDiff(repo, ["diff", "--quiet"]), this.noDiff(repo, ["diff", "--cached", "--quiet", destination]), this.required(repo, ["ls-files", "--others", "--exclude-standard"]),
      this.required(repo, ["symbolic-ref", "--short", "HEAD"]), this.required(repo, ["rev-parse", `refs/heads/${proof.developmentBranch}`]),
      this.required(repo, ["rev-parse", `refs/remotes/${proof.destinationRemote}/${proof.destinationBranch}`]), this.required(repo, ["remote", "get-url", proof.destinationRemote]), this.required(repo, ["rev-parse", "--show-object-format"]),
    ]);
    if (!worktreeClean || !indexMatchesDestination || untracked !== "" || branch !== proof.developmentBranch || development !== proof.expectedDevelopmentSha || tracking !== proof.expectedDestinationTrackingSha || remoteUrl !== proof.expectedRemoteUrl || objectFormat !== proof.objectFormat) throw new Error("Local Git mutation proof changed; no mutation was permitted.");
  }
  private async assertCommittedProof(repo: string, destination: string, proof: SyncMutationProof): Promise<void> {
    const [dirty, branch, development, tracking, remoteUrl, objectFormat] = await Promise.all([
      this.required(repo, ["status", "--porcelain"]), this.required(repo, ["symbolic-ref", "--short", "HEAD"]), this.required(repo, ["rev-parse", `refs/heads/${proof.developmentBranch}`]),
      this.required(repo, ["rev-parse", `refs/remotes/${proof.destinationRemote}/${proof.destinationBranch}`]), this.required(repo, ["remote", "get-url", proof.destinationRemote]), this.required(repo, ["rev-parse", "--show-object-format"]),
    ]);
    if (dirty !== "" || branch !== proof.developmentBranch || development !== destination || tracking !== destination || remoteUrl !== proof.expectedRemoteUrl || objectFormat !== proof.objectFormat) throw new Error("Local Git mutation proof changed during ref commit; recovery was required.");
  }
  private async assertStagedProof(staged: string, proof: SyncMutationProof, stagedRef: string, expectedSha: string, kind: "commit" | "object"): Promise<void> {
    const [development, destination, format, selected] = await Promise.all([
      this.required(staged, ["rev-parse", "refs/shipyard/staged-development"]), this.required(staged, ["rev-parse", "refs/shipyard/staged-destination"]),
      this.required(staged, ["rev-parse", "--show-object-format"]), this.required(staged, ["rev-parse", "--verify", `${stagedRef}^{${kind}}`]),
    ]);
    if (development !== proof.expectedDevelopmentSha || destination !== proof.expectedDestinationTrackingSha || format !== proof.objectFormat || selected !== expectedSha) throw new Error("Staged Git mutation proof changed; no mutation was permitted.");
  }
  private async restoreFastForwardRefs(repo: string, branch: string, trackingRef: string, expected: string, trackingBefore: string, destination: string): Promise<void> {
    let mainNow = await this.optional(repo, `refs/heads/${branch}`); let trackingNow = await this.optional(repo, trackingRef);
    if (mainNow === destination && trackingNow === destination) {
      const rollback = await prepareRefTransaction(this.executable, repo, [{ ref: `refs/heads/${branch}`, next: expected, previous: destination }, { ref: trackingRef, next: trackingBefore, previous: destination }], this.transaction);
      try { await rollback.commit(); } catch (error) { await rollback.abort(); mainNow = await this.optional(repo, `refs/heads/${branch}`); trackingNow = await this.optional(repo, trackingRef); if (mainNow !== expected || trackingNow !== trackingBefore) throw error; }
    }
    mainNow = await this.optional(repo, `refs/heads/${branch}`); trackingNow = await this.optional(repo, trackingRef);
    if (mainNow !== expected || trackingNow !== trackingBefore) throw new Error("Fast-forward refs no longer match either exact pre-commit or committed state.");
  }
  private async noDiff(repo: string, args: string[]): Promise<boolean> { try { await this.required(repo, args); return true; } catch { return false; } }
  private async treeAndWorktreeEqual(repo: string, commit: string): Promise<boolean> { try { return await this.required(repo, ["write-tree"]) === await this.required(repo, ["rev-parse", `${commit}^{tree}`]) && await this.required(repo, ["diff", "--quiet"]) === ""; } catch { return false; } }
  private async required(repo: string, args: string[]): Promise<string> {
    try { const { stdout } = await exec(this.executable, ["-C", repo, ...args], { encoding: "utf8", env: sanitizedGitEnvironment(), timeout: this.command.timeoutMs, maxBuffer: this.command.maxOutputBytes, killSignal: "SIGKILL" }); return stdout.trim(); }
    catch (error) { throw safeLocalGitError(error); }
  }
}

type RefUpdate = Readonly<{ ref: string; next: string; previous: string }>;
async function prepareRefTransaction(executable: string, repositoryPath: string, updates: readonly RefUpdate[], limits: TransactionLimits) {
  const child = (limits.transactionSpawner ?? spawn)(executable, ["-C", repositoryPath, "update-ref", "--stdin"], { env: sanitizedGitEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
  let output = ""; let diagnostic = ""; let outputBytes = 0; let finished = false; let terminalError: Error | undefined;
  let resolvePrepared!: () => void; let rejectPrepared!: (error: Error) => void; let preparedSettled = false;
  const prepared = new Promise<void>((resolve, reject) => { resolvePrepared = resolve; rejectPrepared = reject; });
  const settlePrepared = (error?: Error) => { if (preparedSettled) return; preparedSettled = true; error ? rejectPrepared(error) : resolvePrepared(); };
  const fail = (message: string) => {
    terminalError ??= new Error(message);
    settlePrepared(terminalError);
    if (!finished && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  const collect = (target: "output" | "diagnostic", chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    const text = chunk.toString("utf8");
    if (target === "output") output = (output + text).slice(0, limits.transactionMaxOutputBytes);
    else diagnostic = (diagnostic + text).slice(0, limits.transactionMaxOutputBytes);
    if (outputBytes > limits.transactionMaxOutputBytes) fail("Git ref transaction exceeded its output limit.");
    else if (output.includes("prepare: ok")) settlePrepared();
  };
  child.stdout.on("data", (chunk: Buffer) => collect("output", chunk));
  child.stderr.on("data", (chunk: Buffer) => collect("diagnostic", chunk));
  child.once("error", () => fail("Git ref transaction could not be started."));
  child.stdin.on("error", () => fail("Git ref transaction input closed unexpectedly."));
  const timer = setTimeout(() => fail("Git ref transaction timed out."), limits.transactionTimeoutMs);
  const exit = new Promise<void>((resolve, reject) => child.once("close", code => {
    finished = true; clearTimeout(timer);
    const error = terminalError ?? (code === 0 ? undefined : new Error(safeTransactionDiagnostic(diagnostic || output, code)));
    if (!preparedSettled) settlePrepared(error ?? new Error("Git ref transaction exited before prepare."));
    error ? reject(error) : resolve();
  }));
  void prepared.catch(() => {}); void exit.catch(() => {});
  try { child.stdin.write(`start\n${updates.map(update => `update ${update.ref} ${update.next} ${update.previous}`).join("\n")}\nprepare\n`); }
  catch { fail("Git ref transaction input closed unexpectedly."); }
  try { await prepared; }
  catch (error) { try { await exit; } catch { /* deterministic child teardown completed */ } throw error; }
  return {
    commit: async () => { if (finished) throw new Error("Prepared ref transaction ended before commit."); try { child.stdin.end("commit\n"); } catch { fail("Git ref transaction input closed unexpectedly."); } await exit; },
    abort: async () => { if (finished) return; try { child.stdin.end("abort\n"); } catch { fail("Git ref transaction input closed unexpectedly."); } try { await exit; } catch { /* original transaction error remains authoritative */ } },
  };
}

function safeTransactionDiagnostic(value: string, code: number | null): string {
  const safe = redactGitTransportDiagnostic(value).replace(/[^\x20-\x7e\n\t]/g, "?").slice(0, 512).trim();
  return safe ? `Git ref transaction failed: ${safe}` : `Git ref transaction exited ${code ?? "without a status"}.`;
}

function safeLocalGitError(error: unknown): Error {
  const failure = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string; stderr?: string; stdout?: string };
  const message = failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "Local Git command exceeded its output limit and was killed." : failure.killed || failure.signal ? "Local Git command timed out and was killed." : "Local Git command failed.";
  const safe = new Error(message) as Error & { code?: string | number };
  if (typeof failure.code === "number") safe.code = failure.code;
  return safe;
}
