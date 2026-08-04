import { createHash } from "node:crypto";
import { SyncError } from "./errors.js";
import type { SourceProvenance } from "./types.js";

/** A deterministic private ref namespace; source names are never product refs. */
export function canonicalSourceRef(remote: string, source: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(remote)) throw new SyncError("remote-identity", "Destination remote name is unsafe.");
  return `refs/shipyard/source/${remote}/${createHash("sha256").update(source).digest("hex")}`;
}

export function sourceProvenancePath(remote: string, source: string): string {
  const ref = canonicalSourceRef(remote, source).slice("refs/shipyard/source/".length).replace("/", "-");
  return `sync/source/${ref}.json`;
}

export function validateSourceProvenance(value: unknown): SourceProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncError("source-stale", "Source provenance is malformed.");
  const record = value as Record<string, unknown>; const keys = ["schemaVersion", "remoteName", "remoteUrl", "requestedRef", "localRef", "sha", "objectFormat", "observedAt", "ledgerCheckpointSha"].sort();
  if (Object.keys(record).sort().join("\0") !== keys.join("\0") || record.schemaVersion !== 1 || (record.objectFormat !== "sha1" && record.objectFormat !== "sha256")) throw new SyncError("source-stale", "Source provenance has unsupported or extra fields.");
  for (const key of ["remoteName", "remoteUrl", "requestedRef", "localRef", "sha", "observedAt", "ledgerCheckpointSha"]) if (typeof record[key] !== "string" || record[key] === "") throw new SyncError("source-stale", "Source provenance contains an invalid field.");
  const length = record.objectFormat === "sha1" ? 40 : 64; if (!new RegExp(`^[a-f0-9]{${length}}$`).test(record.sha as string) || !new RegExp(`^[a-f0-9]{${length}}$`).test(record.ledgerCheckpointSha as string)) throw new SyncError("source-stale", "Source provenance object IDs do not match its object format.");
  if (canonicalSourceRef(record.remoteName as string, record.requestedRef as string) !== record.localRef || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(record.remoteUrl as string)) throw new SyncError("source-stale", "Source provenance identity is not canonical.");
  const time = Date.parse(record.observedAt as string); if (!Number.isFinite(time) || new Date(time).toISOString() !== record.observedAt) throw new SyncError("source-stale", "Source provenance timestamp is not canonical.");
  return deepFreeze(structuredClone(record)) as SourceProvenance;
}
function deepFreeze<T>(value: T): T { if (value && typeof value === "object") { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value); } return value; }
