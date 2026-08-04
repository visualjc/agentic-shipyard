import { isAbsolute, resolve } from "node:path";

export const GRAPH_COMMAND_MAX_BYTES = 4096;
export type GraphCommandResult = Readonly<{ code: number; stdout: string; stderr: string; timedOut: boolean }>;
/** Sanitized bounded local-command receipt. It deliberately carries no thrown child-process diagnostic. */
export function snapshotGraphCommandResult(value: unknown): GraphCommandResult | undefined {
  try {
    if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return undefined;
    const d = Object.getOwnPropertyDescriptors(value); const keys = Object.keys(d);
    if (keys.length !== 4 || keys.some((key) => !["code", "stdout", "stderr", "timedOut"].includes(key)) || Object.values(d).some((x) => !("value" in x))) return undefined;
    const { code, stdout, stderr, timedOut } = Object.fromEntries(Object.entries(d).map(([k, x]) => [k, x.value]));
    if (!Number.isSafeInteger(code) || typeof stdout !== "string" || typeof stderr !== "string" || typeof timedOut !== "boolean" || Buffer.byteLength(stdout) > GRAPH_COMMAND_MAX_BYTES || Buffer.byteLength(stderr) > GRAPH_COMMAND_MAX_BYTES) return undefined;
    return Object.freeze({ code, stdout, stderr, timedOut });
  } catch { return undefined; }
}
export function canonicalExecutable(path: unknown): string | undefined { return typeof path === "string" && isAbsolute(path) && resolve(path) === path ? path : undefined; }
export function commandFailure(result: unknown): string | undefined { const safe = snapshotGraphCommandResult(result); return !safe || safe.timedOut ? "Experimental graph command failed safely." : safe.code !== 0 ? "Experimental graph command returned non-zero." : undefined; }
