import { createHash } from "node:crypto";
import { SyncError } from "./errors.js";
import type { SourceProvenance } from "./types.js";

export type SourceReceipt = Readonly<{
  schemaVersion: 1;
  remoteName: string;
  requestedRef: string;
  sha: string;
  observedAt: string;
}>;

const PROVENANCE_KEYS = ["schemaVersion", "remoteName", "remoteUrl", "requestedRef", "localRef", "sha", "objectFormat", "observedAt", "ledgerCheckpointSha"] as const;
const RECEIPT_KEYS = ["schemaVersion", "remoteName", "requestedRef", "sha", "observedAt"] as const;

/** A deterministic private ref namespace; source names are never product refs. */
export function canonicalSourceRef(remote: string, source: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(remote)) throw invalidProvenance();
  if (!isSafeSourceRef(source)) throw invalidProvenance();
  return `refs/shipyard/source/${remote}/${createHash("sha256").update(source).digest("hex")}`;
}

export function sourceProvenancePath(remote: string, source: string): string {
  const ref = canonicalSourceRef(remote, source).slice("refs/shipyard/source/".length).replace("/", "-");
  return `sync/source/${ref}.json`;
}

export function sourceReceiptPath(observedAt: string, remote: string, source: string): string {
  requireCanonicalTimestamp(observedAt);
  return `sync/source-receipts/${observedAt.replace(/[:.]/g, "-")}-${sourceProvenancePath(remote, source).split("/").at(-1)!}`;
}

export function validateSourceReceipt(value: unknown): SourceReceipt {
  const record = descriptorSnapshot(value, RECEIPT_KEYS);
  if (record.schemaVersion !== 1) throw invalidProvenance();
  const remoteName = requiredString(record.remoteName);
  const requestedRef = requiredString(record.requestedRef);
  const sha = requiredString(record.sha);
  const observedAt = requiredString(record.observedAt);
  canonicalSourceRef(remoteName, requestedRef);
  requireCanonicalTimestamp(observedAt);
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(sha)) throw invalidProvenance();
  return Object.freeze({ schemaVersion: 1, remoteName, requestedRef, sha, observedAt });
}

export function sourceReceiptContents(receipt: SourceReceipt): string {
  return `${JSON.stringify(validateSourceReceipt(receipt))}\n`;
}

export function sourceProvenanceContents(provenance: SourceProvenance): string {
  return `${JSON.stringify(validateSourceProvenance(provenance), null, 2)}\n`;
}

/**
 * Treat serialized provenance as hostile input. Reflection is guarded, only
 * own enumerable data properties are accepted, and the caller's object is
 * never read through normal property access or retained after validation.
 */
export function validateSourceProvenance(value: unknown): SourceProvenance {
  const record = descriptorSnapshot(value, PROVENANCE_KEYS);
  if (record.schemaVersion !== 1 || record.objectFormat !== "sha1" && record.objectFormat !== "sha256") throw invalidProvenance();
  const remoteName = requiredString(record.remoteName);
  const remoteUrl = requiredString(record.remoteUrl);
  const requestedRef = requiredString(record.requestedRef);
  const localRef = requiredString(record.localRef);
  const sha = requiredString(record.sha);
  const observedAt = requiredString(record.observedAt);
  const ledgerCheckpointSha = requiredString(record.ledgerCheckpointSha);
  const objectFormat = record.objectFormat;
  const length = objectFormat === "sha1" ? 40 : 64;
  const objectId = new RegExp(`^[a-f0-9]{${length}}$`);
  if (!objectId.test(sha) || !objectId.test(ledgerCheckpointSha)) throw invalidProvenance();
  if (canonicalSourceRef(remoteName, requestedRef) !== localRef || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(remoteUrl)) throw invalidProvenance();
  requireCanonicalTimestamp(observedAt);
  return Object.freeze({ schemaVersion: 1, remoteName, remoteUrl, requestedRef, localRef, sha, objectFormat, observedAt, ledgerCheckpointSha });
}

export function isSafeSourceRef(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/@-]{0,255}$/.test(value) && !value.includes("*") && !value.includes(":") && !value.includes("//") && !value.split("/").some(part => part === "." || part === "..") && !value.startsWith("-") && !value.endsWith("/");
}

function descriptorSnapshot<const Keys extends readonly string[]>(value: unknown, expectedKeys: Keys): Record<Keys[number], unknown> {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalidProvenance();
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expectedKeys.length || keys.some(key => typeof key !== "string" || !expectedKeys.includes(key))) throw invalidProvenance();
    const snapshot: Record<string, unknown> = {};
    for (const key of expectedKeys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw invalidProvenance();
      snapshot[key] = descriptor.value;
    }
    return snapshot as Record<Keys[number], unknown>;
  } catch {
    throw invalidProvenance();
  }
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value === "") throw invalidProvenance();
  return value;
}

function requireCanonicalTimestamp(value: string): void {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw invalidProvenance();
}

function invalidProvenance(): SyncError {
  return new SyncError("source-stale", "Source provenance is malformed or non-canonical.");
}
