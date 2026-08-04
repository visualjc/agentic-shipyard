import type { RepositoryRef, Topology } from "../contracts/types.js";

export const CONTEXT_ROLES = ["implementer", "reviewer", "status"] as const;
export const CANONICAL_LEDGER_REF = "refs/heads/shipyard-ledger";
export type ContextRole = (typeof CONTEXT_ROLES)[number];

/** The only host-specific handoff data. Keep this shape independent of any host SDK. */
export type ContextAdapterRequest = Readonly<{ host: string; role: ContextRole; envelopePath: string; repoRoot: string }>;
/** Trusted dispatch capability, supplied by the host rather than the serialized envelope. */
export type ContextDispatchExpectation = Readonly<{
  profile: string;
  deliveryId: string;
  host: string;
  role: ContextRole;
  envelopePath: string;
  repoRoot: string;
  productBranch: string;
  productSha: string;
  ledgerRef: string;
  ledgerSha: string;
}>;

/** A self-contained, pinned, role-limited ledger context. */
export type ContextEnvelope = Readonly<{
  schemaVersion: 1;
  profile: string;
  topology: Readonly<Topology>;
  repository: Readonly<RepositoryRef>;
  deliveryId: string;
  host: string;
  role: ContextRole;
  productBranch: string;
  productSha: string;
  ledgerRef: string;
  ledgerSha: string;
  records: readonly string[];
  adapter: ContextAdapterRequest;
}>;

export type ContextEnvelopeInput = Omit<ContextEnvelope, "schemaVersion" | "records" | "adapter"> & {
  envelopePath: string;
  repoRoot: string;
  records?: readonly string[];
};

/** Deliberately narrow: records must be read from the envelope's exact ledger object. */
export interface PinnedLedgerReader {
  read(ledgerSha: string, paths: readonly string[]): Promise<Readonly<Record<string, string>>>;
}

export interface ProductShaReader {
  currentProductSha(repoRoot: string): Promise<string>;
}
