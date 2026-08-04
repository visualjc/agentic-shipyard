import { ContextError } from "./errors.js";
import { validateContextEnvelope } from "./envelope.js";
import type { ContextDispatchExpectation, ContextEnvelope, PinnedLedgerReader, ProductShaReader } from "./types.js";

export type LoadedContext = Readonly<{ envelope: ContextEnvelope; records: Readonly<Record<string, string>> }>;

/** Loads a role envelope only after proving the current product still matches its pin. */
export class ContextReader {
  constructor(private readonly expectation: ContextDispatchExpectation, private readonly products: ProductShaReader, private readonly ledger: PinnedLedgerReader) {}

  async load(untrustedEnvelope: ContextEnvelope): Promise<LoadedContext> {
    const envelope = validateContextEnvelope(untrustedEnvelope);
    if (!matchesExpectation(envelope, this.expectation)) {
      throw new ContextError("context-dispatch-mismatch", "The serialized envelope does not match the trusted dispatch capability.");
    }
    const current = await this.products.currentProductSha(envelope.adapter.repoRoot);
    if (current !== envelope.productSha) {
      throw new ContextError("context-stale-product", "The product SHA changed; create a fresh context envelope before reading ledger records.");
    }
    const records = await this.ledger.read(envelope.ledgerSha, envelope.records);
    for (const path of envelope.records) if (typeof records[path] !== "string") {
      throw new ContextError("context-ledger-record-missing", "The pinned ledger does not contain every record required by this envelope.");
    }
    return deepFreeze({ envelope, records: Object.fromEntries(envelope.records.map((path) => [path, records[path]])) });
  }
}

function matchesExpectation(envelope: ContextEnvelope, expected: ContextDispatchExpectation): boolean {
  return envelope.profile === expected.profile && envelope.deliveryId === expected.deliveryId && envelope.host === expected.host && envelope.role === expected.role
    && envelope.adapter.host === expected.host && envelope.adapter.role === expected.role && envelope.adapter.envelopePath === expected.envelopePath && envelope.adapter.repoRoot === expected.repoRoot
    && envelope.productBranch === expected.productBranch && envelope.productSha === expected.productSha && envelope.ledgerRef === expected.ledgerRef && envelope.ledgerSha === expected.ledgerSha;
}

function deepFreeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); Object.freeze(value); } return value; }
