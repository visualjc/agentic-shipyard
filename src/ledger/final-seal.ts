import { createHash } from "node:crypto";
import { stableDeliveryId } from "../delivery/registry.js";
import { LedgerError } from "./errors.js";
import { validLedgerPath } from "./transaction.js";
import type { LedgerCommitInspection, LedgerStore } from "./types.js";

export type FinalLedgerSealManifestEntry = Readonly<{ path: string; sha256: string }>;
export type FinalLedgerSeal = Readonly<{
  schemaVersion: 1;
  deliveryId: string;
  productSha: string;
  /** The exact ledger head whose tree was sealed. The seal commit is its child. */
  preSealLedgerSha: string;
  manifest: readonly FinalLedgerSealManifestEntry[];
}>;

export type CreateFinalLedgerSeal = Readonly<{
  deliveryId: string;
  productSha: string;
  preSealLedgerSha: string;
  records: Readonly<Record<string, string>>;
}>;

export type SealDeliveryRequest = Readonly<{
  deliveryId: string;
  productSha: string;
  recordPaths: readonly string[];
}>;

export type FinalLedgerSealObservation = Readonly<{
  /** Stored outside the seal to avoid making a commit contain its own object ID. */
  externalSealCommitSha: string;
  observedCommit: LedgerCommitInspection;
  currentProductSha: string;
  sealContents: string;
  /** Exact bytes for exactly the records named by the seal manifest. */
  records: Readonly<Record<string, string>>;
}>;

export function finalSealPath(deliveryId: string): string {
  return `deliveries/${canonicalDeliveryId(deliveryId)}/final-seal.json`;
}

/** Builds the durable, byte-hashing manifest in locale-independent path order. */
export function finalSealManifest(deliveryId: string, records: Readonly<Record<string, string>>): readonly FinalLedgerSealManifestEntry[] {
  const canonicalId = canonicalDeliveryId(deliveryId);
  if (!plainRecord(records)) throw invalid("Final seal records must be a path-to-bytes object.");
  const entries = Object.entries(records);
  if (entries.length === 0) throw invalid("A final seal must cover at least one durable record.");
  const manifest = entries.map(([path, contents]) => {
    requireSealedRecordPath(canonicalId, path);
    if (typeof contents !== "string") throw invalid("Final seal record contents must be exact UTF-8 text bytes.");
    return Object.freeze({ path, sha256: sha256(contents) });
  }).sort((left, right) => lexical(left.path, right.path));
  return Object.freeze(manifest);
}

/** Serializes the only canonical version-1 seal representation. */
export function createFinalLedgerSeal(input: CreateFinalLedgerSeal): string {
  const seal: FinalLedgerSeal = Object.freeze({
    schemaVersion: 1,
    deliveryId: canonicalDeliveryId(input.deliveryId),
    productSha: fullObjectId(input.productSha, "product SHA"),
    preSealLedgerSha: fullObjectId(input.preSealLedgerSha, "pre-seal ledger SHA"),
    manifest: finalSealManifest(input.deliveryId, input.records),
  });
  return JSON.stringify(seal);
}

/** Strictly parses untrusted seal bytes, including exact keys and canonical serialization. */
export function validateFinalLedgerSeal(contents: string): FinalLedgerSeal {
  if (typeof contents !== "string") throw invalid("Final seal must be UTF-8 JSON text.");
  let value: unknown;
  try { value = JSON.parse(contents); } catch { throw invalid("Final seal is not valid JSON."); }
  if (!plainRecord(value) || !exactKeys(value, ["schemaVersion", "deliveryId", "productSha", "preSealLedgerSha", "manifest"]) || value.schemaVersion !== 1 || !Array.isArray(value.manifest)) {
    throw invalid("Final seal is not an exact version-1 document.");
  }
  const deliveryId = canonicalDeliveryId(value.deliveryId);
  const productSha = fullObjectId(value.productSha, "product SHA");
  const preSealLedgerSha = fullObjectId(value.preSealLedgerSha, "pre-seal ledger SHA");
  if (value.manifest.length === 0) throw invalid("A final seal must cover at least one durable record.");
  const manifest = value.manifest.map((entry): FinalLedgerSealManifestEntry => {
    if (!plainRecord(entry) || !exactKeys(entry, ["path", "sha256"]) || typeof entry.path !== "string" || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw invalid("Final seal manifest entries must contain only a canonical path and SHA-256.");
    }
    requireSealedRecordPath(deliveryId, entry.path);
    return Object.freeze({ path: entry.path, sha256: entry.sha256 });
  });
  for (let index = 1; index < manifest.length; index += 1) {
    if (lexical(manifest[index - 1]!.path, manifest[index]!.path) >= 0) throw invalid("Final seal manifest paths must be unique and strictly sorted.");
  }
  const seal: FinalLedgerSeal = Object.freeze({ schemaVersion: 1, deliveryId, productSha, preSealLedgerSha, manifest: Object.freeze(manifest) });
  if (JSON.stringify(seal) !== contents) throw invalid("Final seal bytes are not canonically serialized.");
  return seal;
}

/**
 * Pure verification of facts read by a trusted Git adapter. The external seal
 * commit ID is deliberately not embedded in the seal, so the commit can be
 * created normally and its ID retained by the caller.
 */
export function verifyFinalLedgerSeal(observation: FinalLedgerSealObservation): FinalLedgerSeal {
  const externalCommit = fullObjectId(observation.externalSealCommitSha, "external seal commit SHA");
  const commit = validateInspection(observation.observedCommit);
  if (commit.commitSha !== externalCommit) throw invalid("The observed ledger commit is not the external seal commit.");
  const seal = validateFinalLedgerSeal(observation.sealContents);
  if (fullObjectId(observation.currentProductSha, "current product SHA") !== seal.productSha) throw invalid("The sealed product SHA is stale or belongs to another product state.");
  if (commit.parentSha !== seal.preSealLedgerSha) throw invalid("The seal commit parent is not the pre-seal ledger head.");
  if (commit.changes.length !== 1 || commit.changes[0]!.status !== "added" || commit.changes[0]!.path !== finalSealPath(seal.deliveryId)) {
    throw invalid("The seal commit must add only its non-self-referential final-seal record.");
  }
  if (!plainRecord(observation.records) || Object.hasOwn(observation.records, finalSealPath(seal.deliveryId))) throw invalid("Observed sealed records contain invalid or self-referential paths.");
  const observedManifest = finalSealManifest(seal.deliveryId, observation.records);
  if (JSON.stringify(observedManifest) !== JSON.stringify(seal.manifest)) throw invalid("Observed ledger record membership or exact bytes do not match the final seal.");
  return seal;
}

/** Snapshots and atomically seals exactly the caller-declared durable records. */
export async function sealDelivery(store: LedgerStore, request: SealDeliveryRequest): Promise<string> {
  const deliveryId = canonicalDeliveryId(request.deliveryId);
  const productSha = fullObjectId(request.productSha, "product SHA");
  if (!Array.isArray(request.recordPaths) || request.recordPaths.length === 0) throw invalid("A final seal requires explicit durable record paths.");
  const paths = request.recordPaths.map((path) => {
    if (typeof path !== "string") throw invalid("Final seal record paths must be strings.");
    requireSealedRecordPath(deliveryId, path);
    return path;
  });
  if (new Set(paths).size !== paths.length) throw new LedgerError("ledger-duplicate-path", "A final seal may name each durable record path only once.");
  const sealPath = finalSealPath(deliveryId);
  const snapshot = await store.snapshot([...paths, sealPath]);
  const expectedPaths = new Set([...paths, sealPath]);
  if (Object.keys(snapshot.records).some((path) => !expectedPaths.has(path))) throw invalid("Ledger snapshot returned records outside the exact seal request.");
  if (snapshot.records[sealPath] !== undefined) throw new LedgerError("ledger-path-conflict", "Delivery already has an immutable final seal.");
  if (paths.some((path) => snapshot.records[path] === undefined)) throw invalid("Every final-seal record must exist at the exact pre-seal ledger head.");
  const preSealLedgerSha = fullObjectId(snapshot.head, "pre-seal ledger SHA");
  const records = Object.fromEntries(paths.map((path) => [path, snapshot.records[path]!]));
  const contents = createFinalLedgerSeal({ deliveryId, productSha, preSealLedgerSha, records });
  const sealCommitSha = fullObjectId(await store.transact({
    expectedHead: preSealLedgerSha,
    writes: [{ path: sealPath, contents }],
    message: `seal delivery ${deliveryId}`,
  }), "external seal commit SHA");
  if (sealCommitSha === preSealLedgerSha) throw invalid("A seal transaction must create a distinct child commit.");
  return sealCommitSha;
}

function validateInspection(value: unknown): LedgerCommitInspection {
  if (!plainRecord(value) || !exactKeys(value, ["commitSha", "parentSha", "changes"]) || !Array.isArray(value.changes)) throw invalid("Ledger commit inspection is malformed.");
  const commitSha = fullObjectId(value.commitSha, "observed seal commit SHA");
  const parentSha = fullObjectId(value.parentSha, "observed seal parent SHA");
  const changes = value.changes.map((change) => {
    if (!plainRecord(change) || !exactKeys(change, ["status", "path"]) || !["added", "modified", "deleted"].includes(String(change.status)) || typeof change.path !== "string" || !validLedgerPath(change.path)) {
      throw invalid("Ledger commit change inspection is malformed.");
    }
    return Object.freeze({ status: change.status as "added" | "modified" | "deleted", path: change.path });
  });
  return Object.freeze({ commitSha, parentSha, changes: Object.freeze(changes) });
}

function requireSealedRecordPath(deliveryId: string, path: string): void {
  if (!validLedgerPath(path) || /[\0-\x1f\x7f]/.test(path) || !path.startsWith(`deliveries/${deliveryId}/`) || path === finalSealPathUnchecked(deliveryId)) {
    throw invalid("Final seals may cover only safe records belonging to the named delivery and never the seal itself.");
  }
}

function canonicalDeliveryId(value: unknown): string {
  try { return stableDeliveryId(value); } catch { throw invalid("Final seal requires a stable delivery ID."); }
}
function finalSealPathUnchecked(deliveryId: string): string { return `deliveries/${deliveryId}/final-seal.json`; }
function fullObjectId(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) throw invalid(`Final seal requires a canonical ${name}.`);
  return value;
}
function sha256(contents: string): string { return createHash("sha256").update(Buffer.from(contents, "utf8")).digest("hex"); }
function lexical(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function plainRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value); return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
function invalid(message: string): LedgerError { return new LedgerError("ledger-invalid-record", message); }
