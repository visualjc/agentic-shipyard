import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, open, readFile, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { canonicalGitExecutable, DEFAULT_NODE_GIT_EXECUTABLE, sanitizedGitEnvironment } from "./git-transport.js";
import { GRAPH_COMMAND_MAX_BYTES, snapshotGraphCommandResult } from "../graph/command.js";
import type { CodeGraphFiles } from "../graph/codegraph.js";
import type { GraphifyFiles, LocalGraphCommand } from "../graph/graphify.js";
import type { GraphCacheLock } from "../graph/types.js";
import { validateGraphLock } from "../graph/validation.js";

const execFileAsync = promisify(execFile);
const CHILD_TIMEOUT_MS = 30_000;
const CHILD_MAX_BUFFER = GRAPH_COMMAND_MAX_BYTES;

export function createNodeLocalGraphCommand(requested: { timeoutMs?: number; maxBytes?: number } = {}): LocalGraphCommand {
  const timeoutMs = Number.isSafeInteger(requested.timeoutMs) && (requested.timeoutMs ?? 0) > 0 ? Math.min(requested.timeoutMs!, CHILD_TIMEOUT_MS) : CHILD_TIMEOUT_MS;
  const maxBytes = Number.isSafeInteger(requested.maxBytes) && (requested.maxBytes ?? 0) > 0 ? Math.min(requested.maxBytes!, CHILD_MAX_BUFFER) : CHILD_MAX_BUFFER;
  return {
    async observe(executable) {
      try {
        const canonical = await canonicalExecutable(executable);
        const manifest = await boundedText(`${canonical}.shipyard-receipt.json`);
        if (!manifest) return undefined;
        const value: unknown = JSON.parse(manifest); if (!plain(value)) return undefined;
        const d = Object.getOwnPropertyDescriptors(value); if (Object.keys(d).sort().join(",") !== "executable,sourceReceipt,version" || Object.values(d).some(x => !("value" in x))) return undefined;
        const observed = Object.fromEntries(Object.entries(d).map(([key, field]) => [key, field.value])) as Record<string, unknown>;
        const versionResult = snapshotGraphCommandResult(await run(canonical, ["--version"], dirname(canonical), {}, timeoutMs, maxBytes));
        const version = versionResult?.stdout.trim();
        if (!versionResult || versionResult.code !== 0 || versionResult.timedOut || versionResult.stderr !== "" || typeof observed.version !== "string" || version !== observed.version || observed.executable !== canonical || typeof observed.sourceReceipt !== "string") return undefined;
        return { executable: canonical, version, sourceReceipt: observed.sourceReceipt };
      } catch { return undefined; }
    },
    async run(command, args, options) { return run(command, args, options.cwd, options.env, timeoutMs, maxBytes); },
  };
}

async function run(command: string, args: readonly string[], cwd: string, env: Readonly<Record<string, string>>, timeoutMs: number, maxBytes: number) {
  try {
    const canonical = await canonicalExecutable(command); const canonicalCwd = await realpath(cwd);
    if (args.length > 64 || args.some(arg => typeof arg !== "string" || Buffer.byteLength(arg) > 4096) || Object.entries(env).some(([key, value]) => !/^[A-Z0-9_]+$/.test(key) || Buffer.byteLength(value) > 4096)) return { code: 1, stdout: "", stderr: "", timedOut: false };
    const result = await execFileAsync(canonical, [...args], { cwd: canonicalCwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: maxBytes, env: { ...env, PATH: "/usr/bin:/bin", LANG: "C" } });
    return { code: 0, stdout: result.stdout, stderr: result.stderr, timedOut: false };
  } catch (error: unknown) {
    const safe = error as { code?: number | string; killed?: boolean; signal?: string };
    return { code: typeof safe.code === "number" ? safe.code : 1, stdout: "", stderr: "", timedOut: safe.killed === true || safe.signal === "SIGTERM" };
  }
}

export function createNodeGraphFiles(gitExecutable = DEFAULT_NODE_GIT_EXECUTABLE): GraphifyFiles & CodeGraphFiles {
  const git = canonicalGitExecutable(gitExecutable);
  return {
    async canonicalPath(path) { try { return await canonicalPath(path); } catch { return undefined; } },
    async exists(path) { try { await lstat(path); return true; } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } },
    async productGraphifyLeak(root) { return await exists(join(root, "graphify-out")) || await exists(join(root, ".graphify")); },
    async copy(from, to) { await cp(from, to, { recursive: true, errorOnExist: true, force: false }); },
    async remove(path) { await rm(path, { recursive: true, force: true }); },
    async addMachineLocalExclude(root, entry) {
      if (entry !== ".codegraph/") throw new Error("unsafe graph exclusion");
      const exclude = await gitText(git, root, ["rev-parse", "--git-path", "info/exclude"]); const path = isAbsolute(exclude) ? exclude : resolve(root, exclude); const current = await boundedText(path) ?? "";
      if (!current.split(/\r?\n/).includes(entry)) { await mkdir(dirname(path), { recursive: true }); const handle = await open(path, "a", 0o600); try { await handle.writeFile(`${current && !current.endsWith("\n") ? "\n" : ""}${entry}\n`, "utf8"); } finally { await handle.close(); } }
    },
    async excluded(root, entry) { if (entry !== ".codegraph/") return false; return (await gitResult(git, root, ["check-ignore", "--no-index", "-q", ".codegraph/probe"])).code === 0; },
    async tracked(path) { const root = dirname(path), relative = basename(path); return (await gitResult(git, root, ["ls-files", "--error-unmatch", "--", relative])).code === 0; },
  };
}

export class NodeGraphLockStore {
  async read(path: string): Promise<GraphCacheLock | undefined> {
    const text = await boundedText(path); if (text === undefined) return undefined;
    try { return validateGraphLock(JSON.parse(text)); } catch { throw new Error("invalid graph lock"); }
  }
  async createExclusive(path: string, lock: GraphCacheLock): Promise<boolean> {
    await mkdir(dirname(path), { recursive: true });
    try { const handle = await open(path, "wx", 0o600); try { await handle.writeFile(JSON.stringify(validateGraphLock(lock)), "utf8"); } finally { await handle.close(); } return true; }
    catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  }
  async removeVerified(path: string, expected: GraphCacheLock): Promise<boolean> { const current = await this.read(path); if (!current || JSON.stringify(current) !== JSON.stringify(validateGraphLock(expected))) return false; await unlink(path); return true; }
}

export function graphDescriptorPath(home: string, adapter: string, worktreeInstanceId: string): string { return join(home, "graph", "descriptors", adapter, `${createHash("sha256").update(worktreeInstanceId).digest("hex")}.json`); }
export async function readGraphDescriptorText(path: string): Promise<string | undefined> { return boundedText(path); }
export async function writeGraphDescriptor(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${process.pid}.tmp`; await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 }); await rename(temporary, path); }
export async function removeGraphDescriptor(path: string): Promise<void> { await rm(path, { force: true }); }

async function canonicalExecutable(path: string): Promise<string> { if (!isAbsolute(path) || resolve(path) !== path) throw new Error(); const value = await realpath(path); if (!(await stat(value)).isFile()) throw new Error(); return value; }
async function canonicalPath(path: string): Promise<string> { if (!isAbsolute(path) || resolve(path) !== path) throw new Error(); try { return await realpath(path); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return join(await realpath(dirname(path)), basename(path)); } }
async function boundedText(path: string): Promise<string | undefined> { try { const value = await readFile(path); if (value.byteLength > 16 * 1024) throw new Error("local graph record exceeds its size limit"); return value.toString("utf8"); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
async function exists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
async function gitText(git: string, cwd: string, args: readonly string[]): Promise<string> { const result = await gitResult(git, cwd, args); if (result.code !== 0) throw new Error("local Git observation failed"); return result.stdout.trim(); }
async function gitResult(git: string, cwd: string, args: readonly string[]) { try { const result = await execFileAsync(git, ["-C", cwd, ...args], { encoding: "utf8", timeout: 10_000, maxBuffer: 256 * 1024, env: sanitizedGitEnvironment({ GIT_TERMINAL_PROMPT: "0" }) }); return { code: 0, stdout: result.stdout, stderr: result.stderr }; } catch (error: unknown) { const e = error as { code?: number }; return { code: typeof e.code === "number" ? e.code : 1, stdout: "", stderr: "" }; } }
function plain(value: unknown): value is Record<string, unknown> { try { return !!value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype; } catch { return false; } }
