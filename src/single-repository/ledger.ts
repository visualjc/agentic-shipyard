import { createHash } from "node:crypto";
import type { LedgerStore } from "../ledger/types.js";
import type { PromotionJournal, PromotionJournalStep } from "../promotion/types.js";
import { SingleRepositoryError } from "./errors.js";
import { singleRepositoryFinalizationIntentContents, singleRepositoryFinalizationReceiptContents, singleRepositoryManifestContents, validateSingleRepositoryFinalizationIntent, validateSingleRepositoryFinalizationReceipt, validateSingleRepositoryManifest } from "./schema.js";
import type { SingleRepositoryFinalizationIntent, SingleRepositoryFinalizationReceipt, SingleRepositoryManifest } from "./types.js";

export function singleRepositoryManifestPath(deliveryId: string): string { return `deliveries/${deliveryId}/promotion/single-repository-manifest.json`; }
export function singleRepositoryFinalizationIntentPath(deliveryId: string): string { return `deliveries/${deliveryId}/finalization/single-repository-intent.json`; }
export function singleRepositoryFinalizationReceiptPath(deliveryId: string): string { return `deliveries/${deliveryId}/finalization/single-repository-receipt.json`; }
export function singleRepositoryManifestDigest(manifest: SingleRepositoryManifest): string { return createHash("sha256").update(singleRepositoryManifestContents(manifest)).digest("hex"); }

/** A recovery proof is keyed by its idempotency key, not globally by step:
 * historical revisions legitimately share steps, but a key may name one tuple. */
export function exactSingleRepositoryJournalTuple(journal: PromotionJournal, step: PromotionJournalStep, idempotencyKey: string, observedSha?: string, providerId?: string): boolean {
  const entries = journal.entries.filter((entry) => entry.idempotencyKey === idempotencyKey);
  return entries.length === 1 && entries[0]!.step === step && entries[0]!.idempotencyKey === idempotencyKey && entries[0]!.observedSha === observedSha && entries[0]!.providerId === providerId;
}

/** Finalization recovery steps are one-shot authority leases. */
export function exactSingleRepositoryOneShotJournalTuple(journal: PromotionJournal, step: PromotionJournalStep, idempotencyKey: string, observedSha?: string, providerId?: string): boolean {
  const entries = journal.entries.filter((entry) => entry.step === step);
  return entries.length === 1 && entries[0]!.idempotencyKey === idempotencyKey && entries[0]!.observedSha === observedSha && entries[0]!.providerId === providerId;
}

export type SingleRepositoryLedgerSnapshot = Readonly<{
  head: string | undefined;
  manifest?: SingleRepositoryManifest;
  intent?: SingleRepositoryFinalizationIntent;
  receipt?: SingleRepositoryFinalizationReceipt;
  manifestBytes?: string;
  intentBytes?: string;
  receiptBytes?: string;
}>;

export class SingleRepositoryLedger {
  constructor(private readonly store: LedgerStore) {}

  async read(deliveryId: string): Promise<SingleRepositoryLedgerSnapshot> {
    const paths = [singleRepositoryManifestPath(deliveryId), singleRepositoryFinalizationIntentPath(deliveryId), singleRepositoryFinalizationReceiptPath(deliveryId)], snapshot = await this.store.snapshot(paths);
    try {
      const manifestBytes = snapshot.records[paths[0]!], intentBytes = snapshot.records[paths[1]!], receiptBytes = snapshot.records[paths[2]!];
      const manifest = manifestBytes === undefined ? undefined : canonicalManifest(manifestBytes), intent = intentBytes === undefined ? undefined : canonicalIntent(intentBytes), receipt = receiptBytes === undefined ? undefined : canonicalReceipt(receiptBytes);
      // A path is part of the immutable delivery authority.  Never let a
      // syntactically-valid record copied from another delivery take control
      // merely because it was found under this delivery's path.
      if ((manifest && manifest.deliveryId !== deliveryId) || (intent && intent.deliveryId !== deliveryId) || (receipt && receipt.deliveryId !== deliveryId)) throw new Error();
      return Object.freeze({ head: snapshot.head, ...(manifest === undefined ? {} : { manifest, manifestBytes }), ...(intent === undefined ? {} : { intent, intentBytes }), ...(receipt === undefined ? {} : { receipt, receiptBytes }) });
    } catch { throw new SingleRepositoryError("checkpoint-conflict", "Single-repository ledger state is malformed or non-canonical."); }
  }

  async writeManifest(expected: SingleRepositoryLedgerSnapshot, manifest: SingleRepositoryManifest): Promise<string> {
    const path = singleRepositoryManifestPath(manifest.deliveryId), contents = singleRepositoryManifestContents(manifest);
    if (expected.manifestBytes === contents) return expected.head ?? "";
    return this.write(expected.head, path, contents, expected.manifestBytes, `Checkpoint single-repository delivery ${manifest.deliveryId}`);
  }

  async writeIntent(expected: SingleRepositoryLedgerSnapshot, intent: SingleRepositoryFinalizationIntent): Promise<string> {
    const path = singleRepositoryFinalizationIntentPath(intent.deliveryId), contents = singleRepositoryFinalizationIntentContents(intent);
    if (expected.intentBytes !== undefined) { if (expected.intentBytes !== contents) throw conflict("A different immutable single-repository finalization intent already exists."); return expected.head!; }
    return this.write(expected.head, path, contents, undefined, `Record single-repository finalization intent ${intent.deliveryId}`);
  }

  async writeReceipt(expected: SingleRepositoryLedgerSnapshot, receipt: SingleRepositoryFinalizationReceipt): Promise<string> {
    const path = singleRepositoryFinalizationReceiptPath(receipt.deliveryId), contents = singleRepositoryFinalizationReceiptContents(receipt);
    if (expected.receiptBytes !== undefined) { if (expected.receiptBytes !== contents) throw conflict("A different immutable single-repository finalization receipt already exists."); return expected.head!; }
    return this.write(expected.head, path, contents, undefined, `Record single-repository finalization receipt ${receipt.deliveryId}`);
  }

  private async write(expectedHead: string | undefined, path: string, contents: string, expectedContents: string | undefined, message: string): Promise<string> {
    try {
      const head = await this.store.transact({ expectedHead, writes: [{ path, contents, ...(expectedContents === undefined ? {} : { expectedContents }) }], message });
      const after = await this.store.snapshot([path]);
      if (after.head !== head || after.records[path] !== contents) throw new Error();
      return head;
    } catch { throw conflict("Single-repository ledger CAS failed; reread before resuming."); }
  }
}

function canonicalManifest(bytes: string): SingleRepositoryManifest { const value = validateSingleRepositoryManifest(JSON.parse(bytes)); if (singleRepositoryManifestContents(value) !== bytes) throw new Error(); return value; }
function canonicalIntent(bytes: string): SingleRepositoryFinalizationIntent { const value = validateSingleRepositoryFinalizationIntent(JSON.parse(bytes)); if (singleRepositoryFinalizationIntentContents(value) !== bytes) throw new Error(); return value; }
function canonicalReceipt(bytes: string): SingleRepositoryFinalizationReceipt { const value = validateSingleRepositoryFinalizationReceipt(JSON.parse(bytes)); if (singleRepositoryFinalizationReceiptContents(value) !== bytes) throw new Error(); return value; }
function conflict(message: string): SingleRepositoryError { return new SingleRepositoryError("checkpoint-conflict", message); }
