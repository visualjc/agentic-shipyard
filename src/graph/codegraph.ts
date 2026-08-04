import { isAbsolute, join, resolve } from "node:path";
import { graphCacheIdentity, graphDecision, validateGraphBaseline, validateGraphDescriptor } from "./freshness.js";
import { snapshotGraphCommandResult } from "./command.js";
import { snapshotGraphSource, type GraphSourceReader } from "./fingerprint.js";
import { snapshotGraphExecutableObservation, withGraphOperationLock, type GraphOperationLock, type LocalGraphCommand } from "./graphify.js";
import type { GraphBaseline, GraphDecision, GraphDescriptor, GraphSource } from "./types.js";

export const CODEGRAPH_RECEIPT = "codegraph@1.5.0#49c11fc2e0c02170742be8411e66a31af611f4b7";
export interface CodeGraphFiles { excluded(path: string, entry: string): Promise<boolean>; addMachineLocalExclude(path: string, entry: string): Promise<void>; tracked(path: string): Promise<boolean>; exists(path: string): Promise<boolean>; canonicalPath(path: string): Promise<string | undefined>; copy?(from: string, to: string): Promise<void>; remove?(path: string): Promise<void>; }
export interface CodeGraphOptions { enabled: boolean; localOnlyApproved: boolean; reviewedToolSource: string; nodeExecutablePath?: string; codegraphExecutablePath?: string; now?(): Date; lock?: GraphOperationLock; sourceReader?: GraphSourceReader; command: LocalGraphCommand; files: CodeGraphFiles; }
function plain(value: unknown): Record<string, unknown> | undefined { try { if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return undefined; const d = Object.getOwnPropertyDescriptors(value); if (Object.values(d).some((x) => !("value" in x))) return undefined; return Object.fromEntries(Object.entries(d).map(([k, x]) => [k, x.value])); } catch { return undefined; } }
function binary(value: unknown): string | undefined { return typeof value === "string" && isAbsolute(value) && resolve(value) === value ? value : undefined; }
async function observed(command: LocalGraphCommand, executable: string, receipt: string): Promise<boolean> { try { const v = snapshotGraphExecutableObservation(await command.observe(executable)); return !!v && v.executable === executable && v.sourceReceipt === receipt && v.version.length > 0; } catch { return false; } }
function successful(value: unknown): boolean { const v = snapshotGraphCommandResult(value); return !!v && v.code === 0 && !v.timedOut && v.stderr === ""; }
const fts5 = ["--experimental-sqlite", "-e", "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');d.exec('CREATE VIRTUAL TABLE x USING fts5(v)')"] as const;

export async function seedCodeGraph(source: GraphSource, baseline: GraphBaseline, options: CodeGraphOptions): Promise<{ decision: GraphDecision; descriptor?: GraphDescriptor }> { return operate(source, options, baseline); }
export async function refreshCodeGraph(source: GraphSource, options: CodeGraphOptions): Promise<{ decision: GraphDecision; descriptor?: GraphDescriptor }> { return operate(source, options); }

async function operate(source: GraphSource, input: CodeGraphOptions, baseline?: GraphBaseline): Promise<{ decision: GraphDecision; descriptor?: GraphDescriptor }> {
  const o = plain(input); if (!o || typeof o.enabled !== "boolean" || typeof o.localOnlyApproved !== "boolean" || typeof o.reviewedToolSource !== "string") return { decision: graphDecision("invalid", "CodeGraph options are invalid.") };
  if (!o.enabled || !o.localOnlyApproved) return { decision: graphDecision("disabled", "CodeGraph is experimental and requires an explicit local-only enabled profile.") };
  const node = binary(o.nodeExecutablePath), codegraph = binary(o.codegraphExecutablePath);
  if (o.reviewedToolSource !== CODEGRAPH_RECEIPT || !node || !codegraph || !o.lock || !o.sourceReader || !o.command || !o.files) return { decision: graphDecision("invalid", "CodeGraph enabled operation lacks a guarded local boundary.") };
  let checked: GraphSource; try { const { validateGraphSource } = await import("./validation.js"); checked = validateGraphSource(source); } catch { return { decision: graphDecision("invalid", "CodeGraph source is invalid.") }; }
  const files = o.files as CodeGraphFiles, command = o.command as LocalGraphCommand, reader = o.sourceReader as GraphSourceReader;
  const worktreeRoot = await files.canonicalPath(checked.worktreeRoot); const cacheRoot = worktreeRoot && await files.canonicalPath(join(worktreeRoot, ".codegraph"));
  if (!worktreeRoot || !cacheRoot || worktreeRoot !== checked.worktreeRoot || cacheRoot !== join(worktreeRoot, ".codegraph")) return { decision: graphDecision("invalid", "CodeGraph cache must be the canonical worktree-local .codegraph root.") };
  const seedSha = baseline ? baseline.source.headSha : undefined, identity = graphCacheIdentity("codegraph", CODEGRAPH_RECEIPT, checked, seedSha);
  const outcome = await withGraphOperationLock(o.lock as GraphOperationLock, cacheRoot, identity, async () => {
    if (!await observed(command, node, "node:sqlite-fts5") || !await observed(command, codegraph, CODEGRAPH_RECEIPT)) return { decision: graphDecision("unavailable", "CodeGraph executable observation failed.") };
    if (!successful(await command.run(node, fts5, { cwd: worktreeRoot, env: { CODEGRAPH_TELEMETRY: "0" } }))) return { decision: graphDecision("unavailable", "Selected Node runtime cannot create an SQLite FTS5 table.") };
    if (baseline) { const valid = validateGraphBaseline(checked, baseline, "codegraph", CODEGRAPH_RECEIPT); if (!valid.authoritative || !files.copy || !files.remove || await files.exists(cacheRoot)) return { decision: valid.authoritative ? graphDecision("invalid", "CodeGraph seed cache must be new.") : valid }; }
    await files.addMachineLocalExclude(worktreeRoot, ".codegraph/");
    if (!await files.excluded(worktreeRoot, ".codegraph/") || await files.tracked(cacheRoot)) return { decision: graphDecision("failed", "CodeGraph cache exclusion is absent or tracked.") };
    if (baseline) {
      try { await files.copy!(baseline.descriptor.cacheRoot, cacheRoot); if (!await files.exists(cacheRoot) || await files.tracked(cacheRoot)) throw new Error(); }
      catch { try { await files.remove!(cacheRoot); } catch {} return { decision: graphDecision("failed", "CodeGraph seed verification failed.") }; }
    } else if (!successful(await command.run(codegraph, ["index"], { cwd: worktreeRoot, env: { CODEGRAPH_TELEMETRY: "0" } })) || !await files.exists(cacheRoot)) return { decision: graphDecision("failed", "CodeGraph refresh verification failed.") };
    let after: GraphSource; try { after = await snapshotGraphSource(reader, worktreeRoot); } catch { return { decision: graphDecision("stale", "Graph source cannot be reread after operation.") }; }
    if (after.headSha !== checked.headSha || after.workingTreeFingerprint !== checked.workingTreeFingerprint || after.worktreeInstanceId !== checked.worktreeInstanceId) return { decision: graphDecision("stale", "Graph source changed while operation ran.") };
    const descriptor: GraphDescriptor = Object.freeze({ adapter: "codegraph", reviewedToolSource: CODEGRAPH_RECEIPT, cacheIdentity: identity, cacheRoot, worktreeRoot, worktreeInstanceId: checked.worktreeInstanceId, indexedCommit: checked.headSha, workingTreeFingerprint: checked.workingTreeFingerprint, refreshedAt: typeof o.now === "function" ? (o.now as () => Date)().toISOString() : "1970-01-01T00:00:00.000Z", ...(seedSha ? { seededFromSha: seedSha } : {}) }); return { decision: validateGraphDescriptor(after, descriptor, "codegraph", CODEGRAPH_RECEIPT), descriptor };
  }, join(resolve(worktreeRoot), "..", ".shipyard-graph-state"));
  return "state" in outcome ? { decision: outcome } : outcome;
}
